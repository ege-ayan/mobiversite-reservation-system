import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import {
  conflict,
  notFound,
  badRequest,
} from '../common/errors/app.exception.js';
import { BookingStatus, Prisma } from '../generated/prisma/client.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { RefundService } from '../payment/refund.service.js';
import { WRITE_TRANSACTION } from '../prisma/transaction.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { recordBookingTransition } from './booking-history.js';
import { BookingQueryService } from './booking-query.service.js';
import {
  toBookingResponse,
  type BookingWithEvent,
} from './booking-response.mapper.js';
import type { BookingRequest } from './dto/booking-request.js';
import type { BookingResponse } from './dto/booking-response.js';
import { requestFingerprint } from './idempotency-key.js';

const ACTIVE_STATUSES: BookingStatus[] = [
  BookingStatus.HELD,
  BookingStatus.PAID,
];

type Tx = Prisma.TransactionClient;

type CancelOutcome =
  | { kind: 'missing' }
  | { kind: 'closed' }
  | { kind: 'started' }
  | { kind: 'cancelled'; booking: BookingWithEvent }
  | { kind: 'refund'; booking: BookingWithEvent };

@Injectable()
export class ReservationService {
  private readonly holdMs: number;
  private readonly maxTicketsPerEvent: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly queries: BookingQueryService,
    private readonly refunds: RefundService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.holdMs = config.get('RESERVATION_HOLD_MS', { infer: true });
    this.maxTicketsPerEvent = config.get('MAX_ACTIVE_TICKETS_PER_EVENT', {
      infer: true,
    });
  }

  async reserve(
    userId: string,
    request: BookingRequest,
    idempotencyKey?: string,
  ): Promise<BookingResponse> {
    const replay = await this.replay(userId, idempotencyKey, request);
    if (replay) {
      return replay;
    }

    const event = await this.prisma.event.findUnique({
      where: { id: request.eventId },
    });
    if (!event || event.deletedAt || event.salesClosedAt) {
      throw notFound('Event not found', 'EVENT_NOT_FOUND');
    }
    if (event.startsAt.getTime() <= Date.now()) {
      throw badRequest('Event has already started', 'EVENT_STARTED');
    }

    const expiresAt = new Date(
      Math.min(Date.now() + this.holdMs, event.startsAt.getTime()),
    );
    try {
      const booking = await this.createHold(
        userId,
        request,
        event.id,
        idempotencyKey,
        expiresAt,
      );
      return toBookingResponse(booking);
    } catch (error) {
      if (!idempotencyKey || !isUniqueConflict(error)) {
        throw error;
      }
      const raced = await this.replay(userId, idempotencyKey, request);
      if (!raced) {
        throw error;
      }
      return raced;
    }
  }

  async cancel(userId: string, bookingId: string): Promise<BookingResponse> {
    const existing = await this.queries.findOwned(userId, bookingId);
    const outcome = await this.prisma.$transaction(
      (tx) => this.cancelLocked(tx, userId, bookingId, existing.eventId),
      WRITE_TRANSACTION,
    );

    if (outcome.kind === 'missing') {
      throw notFound('Reservation not found', 'BOOKING_NOT_FOUND');
    }
    if (outcome.kind === 'closed') {
      throw conflict(
        'Reservation can no longer be cancelled',
        'BOOKING_CLOSED',
      );
    }
    if (outcome.kind === 'started') {
      throw conflict('Event has already started', 'EVENT_STARTED');
    }
    if (outcome.kind === 'refund') {
      await this.refunds.refundBooking(outcome.booking);
      return this.markRefunded(userId, bookingId, outcome.booking);
    }
    return toBookingResponse(outcome.booking);
  }

  private async createHold(
    userId: string,
    request: BookingRequest,
    eventId: string,
    idempotencyKey: string | undefined,
    expiresAt: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.inventory.lockEvent(tx, eventId);
      if (!locked) {
        throw notFound('Event not found', 'EVENT_NOT_FOUND');
      }
      const fresh = await tx.event.findUniqueOrThrow({
        where: { id: eventId },
      });
      if (fresh.deletedAt || fresh.salesClosedAt) {
        throw notFound('Event not found', 'EVENT_NOT_FOUND');
      }
      await this.inventory.releaseExpiredHolds(tx, eventId, new Date());
      const active = await tx.booking.aggregate({
        where: {
          userId,
          eventId,
          status: { in: ACTIVE_STATUSES },
        },
        _sum: { quantity: true },
      });
      const used = active._sum.quantity ?? 0;
      if (used + request.quantity > this.maxTicketsPerEvent) {
        throw conflict(
          `You can reserve at most ${this.maxTicketsPerEvent} tickets for an event`,
          'TICKET_LIMIT',
        );
      }
      const reserved = await tx.event.updateMany({
        where: {
          id: eventId,
          availableTickets: { gte: request.quantity },
        },
        data: { availableTickets: { decrement: request.quantity } },
      });
      if (reserved.count !== 1) {
        throw conflict('Not enough tickets', 'SOLD_OUT');
      }

      const created = await tx.booking.create({
        data: {
          userId,
          eventId,
          quantity: request.quantity,
          ticketPrice: fresh.ticketPrice,
          expiresAt,
          ...(idempotencyKey
            ? {
                idempotencyKey,
                requestHash: requestFingerprint(
                  request.eventId,
                  request.quantity,
                ),
              }
            : {}),
        },
        include: { event: true },
      });
      await recordBookingTransition(tx, {
        bookingId: created.id,
        fromStatus: null,
        toStatus: BookingStatus.HELD,
        reason: 'reserved',
      });
      return created;
    }, WRITE_TRANSACTION);
  }

  private async replay(
    userId: string,
    idempotencyKey: string | undefined,
    request: BookingRequest,
  ): Promise<BookingResponse | null> {
    if (!idempotencyKey) {
      return null;
    }
    const existing = await this.prisma.booking.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include: { event: true },
    });
    if (!existing) {
      return null;
    }
    const fingerprint = requestFingerprint(request.eventId, request.quantity);
    if (existing.requestHash !== fingerprint) {
      throw conflict(
        'Idempotency key was reused for a different request',
        'IDEMPOTENCY_CONFLICT',
      );
    }
    return toBookingResponse(existing);
  }

  private async cancelLocked(
    tx: Tx,
    userId: string,
    bookingId: string,
    eventId: string,
  ): Promise<CancelOutcome> {
    const locked = await this.inventory.lockEvent(tx, eventId);
    if (!locked) {
      throw notFound('Event not found', 'EVENT_NOT_FOUND');
    }
    await this.inventory.releaseExpiredHolds(tx, eventId, new Date());
    const current = await tx.booking.findFirst({
      where: { id: bookingId, userId },
      include: { event: true },
    });
    if (!current) {
      return { kind: 'missing' };
    }
    if (!ACTIVE_STATUSES.includes(current.status)) {
      return { kind: 'closed' };
    }
    if (current.status === BookingStatus.PAID) {
      if (current.event.startsAt.getTime() <= Date.now()) {
        return { kind: 'started' };
      }
      return { kind: 'refund', booking: current };
    }

    const updated = await tx.booking.updateMany({
      where: {
        id: bookingId,
        userId,
        status: BookingStatus.HELD,
      },
      data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
    });
    if (updated.count !== 1) {
      return { kind: 'closed' };
    }
    await recordBookingTransition(tx, {
      bookingId,
      fromStatus: BookingStatus.HELD,
      toStatus: BookingStatus.CANCELLED,
      reason: 'cancelled',
    });

    await tx.event.update({
      where: { id: current.eventId },
      data: { availableTickets: { increment: current.quantity } },
    });
    const cancelled = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { event: true },
    });
    return { kind: 'cancelled', booking: cancelled };
  }

  private async markRefunded(
    userId: string,
    bookingId: string,
    booking: BookingWithEvent,
  ): Promise<BookingResponse> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await this.inventory.lockEvent(tx, booking.eventId);
      if (!locked) {
        throw notFound('Event not found', 'EVENT_NOT_FOUND');
      }
      const result = await tx.booking.updateMany({
        where: { id: bookingId, userId, status: BookingStatus.PAID },
        data: { status: BookingStatus.REFUNDED, refundedAt: new Date() },
      });
      if (result.count !== 1) {
        const current = await tx.booking.findFirst({
          where: { id: bookingId, userId },
          include: { event: true },
        });
        if (current?.status === BookingStatus.REFUNDED) {
          return current;
        }
        return null;
      }
      await recordBookingTransition(tx, {
        bookingId,
        fromStatus: BookingStatus.PAID,
        toStatus: BookingStatus.REFUNDED,
        reason: 'refunded',
      });
      await tx.event.update({
        where: { id: booking.eventId },
        data: { availableTickets: { increment: booking.quantity } },
      });
      return tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: { event: true },
      });
    }, WRITE_TRANSACTION);
    if (!updated) {
      throw conflict(
        'Reservation can no longer be cancelled',
        'BOOKING_CLOSED',
      );
    }
    return toBookingResponse(updated);
  }
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
