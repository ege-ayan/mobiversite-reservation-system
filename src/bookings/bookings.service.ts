import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { BookingStatus, Prisma } from '../generated/prisma/client.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { decodeCursor, slicePage } from '../common/pagination/cursor.js';
import {
  DEFAULT_PAGE_LIMIT,
  type PageQuery,
} from '../common/pagination/page-query.js';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from '../payment/payment.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  toAdminBookingResponse,
  toBookingResponse,
  type BookingWithEvent,
} from './booking-response.mapper.js';
import { SWEEP_LOCK_NAME, SweepLock } from './sweep-lock.js';
import type { AdminBookingPage } from './dto/admin-booking-page.js';
import type { BookingPage } from './dto/booking-page.js';
import type { BookingRequest } from './dto/booking-request.js';
import type { BookingResponse } from './dto/booking-response.js';
import { requestFingerprint } from './idempotency-key.js';

const ACTIVE_STATUSES: BookingStatus[] = [
  BookingStatus.HELD,
  BookingStatus.PAID,
];

const EXPIRY_EVENT_BATCH = 200;

type Tx = Prisma.TransactionClient;

type CancelOutcome =
  | { kind: 'missing' }
  | { kind: 'closed' }
  | { kind: 'started' }
  | { kind: 'cancelled'; booking: BookingWithEvent }
  | { kind: 'refund'; booking: BookingWithEvent };

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);
  private readonly holdMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly sweepLock: SweepLock,
    @Inject(PAYMENT_GATEWAY) private readonly payments: PaymentGateway,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.holdMs = config.get('RESERVATION_HOLD_MS', { infer: true });
  }

  async listForUser(userId: string, query: PageQuery): Promise<BookingPage> {
    const page = await this.pageBookings({ userId }, query);
    return {
      items: page.items.map((booking) => toBookingResponse(booking)),
      nextCursor: page.nextCursor,
    };
  }

  async listForEvent(
    eventId: string,
    query: PageQuery,
  ): Promise<AdminBookingPage> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event || event.deletedAt) {
      throw new NotFoundException('Event not found');
    }
    const page = await this.pageBookings({ eventId }, query, true);
    return {
      items: page.items.map((booking) => toAdminBookingResponse(booking)),
      nextCursor: page.nextCursor,
    };
  }

  async findForUser(
    userId: string,
    bookingId: string,
  ): Promise<BookingResponse> {
    return toBookingResponse(await this.findOwnBooking(userId, bookingId));
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

    await this.inventory.reclaim(request.eventId);

    const event = await this.prisma.event.findUnique({
      where: { id: request.eventId },
    });
    if (!event || event.deletedAt) {
      throw new NotFoundException('Event not found');
    }
    if (event.startsAt.getTime() <= Date.now()) {
      throw new BadRequestException('Event has already started');
    }

    const expiresAt = new Date(Date.now() + this.holdMs);
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
    const existing = await this.findOwnBooking(userId, bookingId);
    const outcome = await this.prisma.$transaction((tx) =>
      this.cancelLocked(tx, userId, bookingId, existing.eventId),
    );

    if (outcome.kind === 'missing') {
      throw new NotFoundException('Reservation not found');
    }
    if (outcome.kind === 'closed') {
      throw new ConflictException('Reservation can no longer be cancelled');
    }
    if (outcome.kind === 'started') {
      throw new ConflictException('Event has already started');
    }
    if (outcome.kind === 'refund') {
      await this.refundPaid(outcome.booking);
      return this.markRefunded(userId, bookingId, outcome.booking);
    }
    return toBookingResponse(outcome.booking);
  }

  async pay(userId: string, bookingId: string): Promise<BookingResponse> {
    const existing = await this.findOwnBooking(userId, bookingId);
    if (existing.status === BookingStatus.PAID) {
      return toBookingResponse(existing);
    }
    if (existing.status !== BookingStatus.HELD) {
      throw new ConflictException('Reservation can no longer be paid');
    }

    await this.inventory.reclaim(existing.eventId);
    const booking = await this.findOwnBooking(userId, bookingId);
    if (booking.event.deletedAt || booking.status === BookingStatus.CANCELLED) {
      throw new ConflictException('Reservation can no longer be paid');
    }
    if (
      booking.status !== BookingStatus.HELD ||
      booking.expiresAt.getTime() <= Date.now()
    ) {
      throw new ConflictException('Reservation expired');
    }

    const paid = await this.payments.confirm({
      bookingId: booking.id,
      amount: amountOf(booking),
    });
    if (!paid) {
      throw new ConflictException('Payment was not confirmed');
    }

    try {
      const confirmed = await this.prisma.$transaction(async (tx) => {
        const locked = await this.inventory.lockEvent(tx, booking.eventId);
        if (!locked) {
          throw new NotFoundException('Event not found');
        }
        const freshEvent = await tx.event.findUnique({
          where: { id: booking.eventId },
        });
        if (!freshEvent || freshEvent.deletedAt) {
          throw new ConflictException('Reservation can no longer be paid');
        }
        await this.inventory.releaseExpiredHolds(
          tx,
          booking.eventId,
          new Date(),
        );
        const updated = await tx.booking.updateMany({
          where: {
            id: bookingId,
            userId,
            status: BookingStatus.HELD,
            expiresAt: { gt: new Date() },
          },
          data: { status: BookingStatus.PAID },
        });
        if (updated.count !== 1) {
          throw new ConflictException('Reservation can no longer be paid');
        }
        return tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          include: { event: true },
        });
      });
      return toBookingResponse(confirmed);
    } catch (error) {
      await this.compensate(booking);
      throw error;
    }
  }

  async settleReservations(eventId: string): Promise<void> {
    const paid = await this.prisma.$transaction(async (tx) => {
      const locked = await this.inventory.lockEvent(tx, eventId);
      if (!locked) {
        throw new NotFoundException('Event not found');
      }
      await this.inventory.releaseExpiredHolds(tx, eventId, new Date());
      await this.cancelHeld(tx, eventId);
      return tx.booking.findMany({
        where: { eventId, status: BookingStatus.PAID },
      });
    });

    for (const booking of paid) {
      await this.refundPaid(booking);
    }
    if (paid.length === 0) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const locked = await this.inventory.lockEvent(tx, eventId);
      if (!locked) {
        throw new NotFoundException('Event not found');
      }
      for (const booking of paid) {
        const updated = await tx.booking.updateMany({
          where: { id: booking.id, status: BookingStatus.PAID },
          data: { status: BookingStatus.REFUNDED },
        });
        if (updated.count === 1) {
          await tx.event.update({
            where: { id: eventId },
            data: { availableTickets: { increment: booking.quantity } },
          });
        }
      }
    });
  }

  async releaseExpiredHolds(now = new Date()): Promise<number> {
    const released = await this.sweepLock.tryWithLock(
      SWEEP_LOCK_NAME,
      async () => {
        const eventIds = await this.prisma.$transaction((tx) =>
          this.expiredEventIds(tx, now),
        );
        let count = 0;
        for (const eventId of eventIds) {
          try {
            count += await this.inventory.reclaim(eventId, now);
          } catch (error) {
            if (error instanceof NotFoundException) {
              continue;
            }
            this.logger.error(
              `Failed to expire holds for event ${eventId}`,
              error,
            );
          }
        }
        return count;
      },
    );
    return released ?? 0;
  }

  private async pageBookings(
    where: { userId: string } | { eventId: string },
    query: PageQuery,
    withUser = false,
  ) {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const bookings = await this.prisma.booking.findMany({
      where: {
        ...where,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.at } },
                { createdAt: cursor.at, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: {
        event: true,
        ...(withUser ? { user: { select: { email: true } } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return slicePage(bookings, limit, (booking) => booking.createdAt);
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
        throw new NotFoundException('Event not found');
      }
      const fresh = await tx.event.findUniqueOrThrow({
        where: { id: eventId },
      });
      if (fresh.deletedAt) {
        throw new NotFoundException('Event not found');
      }
      await this.inventory.releaseExpiredHolds(tx, eventId, new Date());
      const reserved = await tx.event.updateMany({
        where: {
          id: eventId,
          availableTickets: { gte: request.quantity },
        },
        data: { availableTickets: { decrement: request.quantity } },
      });
      if (reserved.count !== 1) {
        throw new ConflictException('Not enough tickets');
      }

      return tx.booking.create({
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
    });
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
      throw new ConflictException(
        'Idempotency key was reused for a different request',
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
      throw new NotFoundException('Event not found');
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
      data: { status: BookingStatus.CANCELLED },
    });
    if (updated.count !== 1) {
      return { kind: 'closed' };
    }

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
        throw new NotFoundException('Event not found');
      }
      const result = await tx.booking.updateMany({
        where: { id: bookingId, userId, status: BookingStatus.PAID },
        data: { status: BookingStatus.REFUNDED },
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
      await tx.event.update({
        where: { id: booking.eventId },
        data: { availableTickets: { increment: booking.quantity } },
      });
      return tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: { event: true },
      });
    });
    if (!updated) {
      throw new ConflictException('Reservation can no longer be cancelled');
    }
    return toBookingResponse(updated);
  }

  private async cancelHeld(tx: Tx, eventId: string): Promise<void> {
    const held = await tx.booking.findMany({
      where: { eventId, status: BookingStatus.HELD },
      select: { quantity: true },
    });
    if (held.length === 0) {
      return;
    }
    await tx.booking.updateMany({
      where: { eventId, status: BookingStatus.HELD },
      data: { status: BookingStatus.CANCELLED },
    });
    const quantity = held.reduce((sum, row) => sum + row.quantity, 0);
    await tx.event.update({
      where: { id: eventId },
      data: { availableTickets: { increment: quantity } },
    });
  }

  private async refundPaid(booking: {
    id: string;
    ticketPrice: Prisma.Decimal;
    quantity: number;
  }): Promise<void> {
    const refunded = await this.payments.refund({
      bookingId: booking.id,
      amount: amountOf(booking),
    });
    if (!refunded) {
      throw new ConflictException('Refund was not confirmed');
    }
  }

  private async compensate(booking: BookingWithEvent): Promise<void> {
    const current = await this.prisma.booking.findUnique({
      where: { id: booking.id },
    });
    if (current?.status === BookingStatus.PAID) {
      return;
    }
    try {
      const refunded = await this.payments.refund({
        bookingId: booking.id,
        amount: amountOf(booking),
      });
      if (!refunded) {
        this.logger.error(`Refund was not confirmed for booking ${booking.id}`);
      }
    } catch (error) {
      this.logger.error(`Refund failed for booking ${booking.id}`, error);
    }
  }

  private async expiredEventIds(tx: Tx, now: Date): Promise<string[]> {
    const rows = await tx.$queryRaw<Array<Record<string, string>>>(
      Prisma.sql`
        SELECT DISTINCT event_id AS eventId
        FROM bookings
        WHERE status = 'HELD' AND expires_at <= ${now}
        LIMIT ${Prisma.raw(String(EXPIRY_EVENT_BATCH))}
      `,
    );
    return rows.flatMap((row) => {
      const eventId = row.eventId ?? row.eventid;
      return eventId ? [eventId] : [];
    });
  }

  private async findOwnBooking(userId: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, userId },
      include: { event: true },
    });
    if (!booking) {
      throw new NotFoundException('Reservation not found');
    }
    return booking;
  }
}

function amountOf(booking: { ticketPrice: Prisma.Decimal; quantity: number }) {
  return booking.ticketPrice.mul(booking.quantity).toFixed(2);
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
