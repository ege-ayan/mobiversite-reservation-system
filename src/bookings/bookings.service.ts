import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { toEventResponse } from '../events/event-response.mapper.js';
import { BookingStatus, Prisma } from '../generated/prisma/client.js';
import { decodeCursor, slicePage } from '../pagination/cursor.js';
import {
  DEFAULT_PAGE_LIMIT,
  type PageQuery,
} from '../pagination/page-query.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { BookingPage } from './dto/booking-page.js';
import type { BookingRequest } from './dto/booking-request.js';
import type { BookingResponse } from './dto/booking-response.js';
import { PaymentClient } from './payment.client.js';

const ACTIVE_STATUSES: BookingStatus[] = [
  BookingStatus.HELD,
  BookingStatus.PAID,
];

const EXPIRY_EVENT_BATCH = 200;
const SWEEP_LOCK = 'mobiversite_booking_expiry';

type BookingWithEvent = Prisma.BookingGetPayload<{ include: { event: true } }>;
type Tx = Prisma.TransactionClient;

type HeldTicket = { id: string; quantity: number };

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);
  private readonly holdMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentClient,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.holdMs = config.get('RESERVATION_HOLD_MS', { infer: true });
  }

  async cancelOpenReservations(tx: Tx, eventId: string): Promise<number> {
    const active = await tx.booking.findMany({
      where: { eventId, status: { in: ACTIVE_STATUSES } },
      select: { quantity: true },
    });
    await tx.booking.updateMany({
      where: { eventId, status: { in: ACTIVE_STATUSES } },
      data: { status: BookingStatus.CANCELLED },
    });
    return active.reduce((sum, row) => sum + row.quantity, 0);
  }

  async listForUser(userId: string, query: PageQuery): Promise<BookingPage> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const bookings = await this.prisma.booking.findMany({
      where: {
        userId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.at } },
                { createdAt: cursor.at, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: { event: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = slicePage(bookings, limit, (booking) => booking.createdAt);
    return {
      items: page.items.map((booking) => toBookingResponse(booking)),
      nextCursor: page.nextCursor,
    };
  }

  async reserve(
    userId: string,
    request: BookingRequest,
  ): Promise<BookingResponse> {
    await this.reclaim(request.eventId);

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
    const booking = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockEvent(tx, event.id);
      if (!locked) {
        throw new NotFoundException('Event not found');
      }
      const fresh = await tx.event.findUniqueOrThrow({
        where: { id: event.id },
      });
      if (fresh.deletedAt) {
        throw new NotFoundException('Event not found');
      }
      await this.releaseEventHolds(tx, event.id, new Date());
      const reserved = await tx.event.updateMany({
        where: {
          id: event.id,
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
          eventId: event.id,
          quantity: request.quantity,
          ticketPrice: fresh.ticketPrice,
          expiresAt,
        },
        include: { event: true },
      });
    });

    return toBookingResponse(booking);
  }

  async cancel(userId: string, bookingId: string): Promise<BookingResponse> {
    const existing = await this.findOwnBooking(userId, bookingId);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockEvent(tx, existing.eventId);
      if (!locked) {
        throw new NotFoundException('Event not found');
      }
      await this.releaseEventHolds(tx, existing.eventId, new Date());
      const current = await tx.booking.findFirst({
        where: { id: bookingId, userId },
        include: { event: true },
      });
      if (!current) {
        return { kind: 'missing' as const };
      }
      if (!ACTIVE_STATUSES.includes(current.status)) {
        return { kind: 'closed' as const };
      }

      const updated = await tx.booking.updateMany({
        where: {
          id: bookingId,
          userId,
          status: { in: ACTIVE_STATUSES },
        },
        data: { status: BookingStatus.CANCELLED },
      });
      if (updated.count !== 1) {
        return { kind: 'closed' as const };
      }

      await tx.event.update({
        where: { id: current.eventId },
        data: { availableTickets: { increment: current.quantity } },
      });
      const cancelled = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: { event: true },
      });
      return { kind: 'cancelled' as const, booking: cancelled };
    });

    if (outcome.kind === 'missing') {
      throw new NotFoundException('Reservation not found');
    }
    if (outcome.kind === 'closed') {
      throw new ConflictException('Reservation can no longer be cancelled');
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

    await this.reclaim(existing.eventId);
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
      amount: booking.ticketPrice.mul(booking.quantity).toFixed(2),
    });
    if (!paid) {
      throw new ConflictException('Payment was not confirmed');
    }

    const confirmed = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockEvent(tx, booking.eventId);
      if (!locked) {
        throw new NotFoundException('Event not found');
      }
      const freshEvent = await tx.event.findUnique({
        where: { id: booking.eventId },
      });
      if (!freshEvent || freshEvent.deletedAt) {
        throw new ConflictException('Reservation can no longer be paid');
      }
      await this.releaseEventHolds(tx, booking.eventId, new Date());
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
  }

  async releaseExpiredHolds(now = new Date()): Promise<number> {
    const eventIds = await this.prisma.$transaction(async (tx) => {
      const leading = await this.tryLockSweep(tx);
      if (!leading) {
        return null;
      }
      try {
        return await this.expiredEventIds(tx, now);
      } finally {
        await this.unlockSweep(tx);
      }
    });
    if (!eventIds) {
      return 0;
    }

    let released = 0;
    for (const eventId of eventIds) {
      try {
        released += await this.reclaim(eventId, now);
      } catch (error) {
        if (error instanceof NotFoundException) {
          continue;
        }
        this.logger.error(`Failed to expire holds for event ${eventId}`, error);
      }
    }
    return released;
  }

  private async reclaim(eventId: string, now = new Date()): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockEvent(tx, eventId);
      if (!locked) {
        throw new NotFoundException('Event not found');
      }
      return this.releaseEventHolds(tx, eventId, now);
    });
  }

  private async releaseEventHolds(
    tx: Tx,
    eventId: string,
    now: Date,
  ): Promise<number> {
    const due = await tx.$queryRaw<HeldTicket[]>`
      SELECT id, quantity
      FROM bookings
      WHERE event_id = ${eventId}
        AND status = 'HELD'
        AND expires_at <= ${now}
      FOR UPDATE
    `;
    if (due.length === 0) {
      return 0;
    }

    const ids = due.map((row) => row.id);
    const updated = await tx.booking.updateMany({
      where: {
        id: { in: ids },
        status: BookingStatus.HELD,
        expiresAt: { lte: now },
      },
      data: { status: BookingStatus.EXPIRED },
    });
    if (updated.count !== due.length) {
      throw new Error('Expired hold set changed during release');
    }

    const quantity = due.reduce((sum, row) => sum + Number(row.quantity), 0);
    await tx.event.update({
      where: { id: eventId },
      data: { availableTickets: { increment: quantity } },
    });
    return due.length;
  }

  private async lockEvent(tx: Tx, eventId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM events WHERE id = ${eventId} FOR UPDATE
    `;
    return rows.length > 0;
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

  private async tryLockSweep(tx: Tx): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ acquired: number | bigint }>>`
      SELECT GET_LOCK(${SWEEP_LOCK}, 0) AS acquired
    `;
    const acquired = rows[0]?.acquired;
    return acquired === 1 || acquired === 1n;
  }

  private async unlockSweep(tx: Tx): Promise<void> {
    await tx.$queryRaw`SELECT RELEASE_LOCK(${SWEEP_LOCK})`;
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

function toBookingResponse(
  booking: BookingWithEvent,
  now = new Date(),
): BookingResponse {
  const expired =
    booking.status === BookingStatus.HELD &&
    booking.expiresAt.getTime() <= now.getTime();
  return {
    id: booking.id,
    eventId: booking.eventId,
    quantity: booking.quantity,
    status: expired ? BookingStatus.EXPIRED : booking.status,
    ticketPrice: booking.ticketPrice.toFixed(2),
    expiresAt: booking.expiresAt,
    createdAt: booking.createdAt,
    event: toEventResponse(booking.event),
  };
}
