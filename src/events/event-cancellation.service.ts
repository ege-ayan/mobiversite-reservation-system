import { Injectable, Logger } from '@nestjs/common';

import { recordBookingTransitions } from '@/bookings/booking-history.js';
import {
  applyPaidRefund,
  returnTickets,
} from '@/bookings/booking-lifecycle.js';
import { conflict, notFound } from '@/common/errors/app.exception.js';
import { ErrorCode } from '@/common/errors/error-code.js';
import {
  CANCELLATION_LOCK_NAME,
  SweepLock,
} from '@/common/locking/mysql-lock.js';
import { BookingStatus, Prisma } from '@/generated/prisma/client.js';
import { InventoryService } from '@/inventory/inventory.service.js';
import { RefundService } from '@/payment/refund.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { runWrite } from '@/prisma/retry.js';

import type { EventCancellationResponse } from './dto/event-cancellation-response.js';

const CANCELLATION_BATCH = 50;
const CANCELLATION_LOCK_WAIT_SECONDS = 30;

type Tx = Prisma.TransactionClient;

@Injectable()
export class EventCancellationService {
  private readonly logger = new Logger(EventCancellationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly refunds: RefundService,
    private readonly sweepLock: SweepLock,
  ) {}

  async request(eventId: string): Promise<EventCancellationResponse> {
    await runWrite(this.prisma, async (tx) => {
      const locked = await this.inventory.lockEvent(tx, eventId);
      if (!locked) {
        throw notFound('Event not found', ErrorCode.EVENT_NOT_FOUND);
      }
      const event = await tx.event.findUnique({ where: { id: eventId } });
      if (!event || event.deletedAt) {
        throw notFound('Event not found', ErrorCode.EVENT_NOT_FOUND);
      }
      if (!event.salesClosedAt) {
        await tx.event.update({
          where: { id: eventId },
          data: { salesClosedAt: new Date() },
        });
      }
    });
    return { id: eventId, status: 'CANCELLING' };
  }

  async processPending(): Promise<number> {
    const processed = await this.sweepLock.tryWithLock(
      CANCELLATION_LOCK_NAME,
      async () => {
        const events = await this.prisma.event.findMany({
          where: { salesClosedAt: { not: null }, deletedAt: null },
          select: { id: true },
          take: CANCELLATION_BATCH,
        });
        let count = 0;
        for (const event of events) {
          try {
            await this.runOne(event.id);
            count += 1;
          } catch (error) {
            this.logger.error(
              `Failed to finish cancellation for event ${event.id}`,
              error instanceof Error ? error.stack : undefined,
            );
          }
        }
        return count;
      },
    );
    return processed ?? 0;
  }

  async processOne(eventId: string): Promise<void> {
    const ran = await this.sweepLock.tryWithLock(
      CANCELLATION_LOCK_NAME,
      () => this.runOne(eventId),
      CANCELLATION_LOCK_WAIT_SECONDS,
    );
    if (ran === null) {
      this.logger.warn(
        `Cancellation for event ${eventId} did not start; another worker still holds the lock`,
      );
    }
  }

  private async runOne(eventId: string): Promise<void> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event || event.deletedAt || !event.salesClosedAt) {
      return;
    }
    await this.settleReservations(eventId);
    await runWrite(this.prisma, async (tx) => {
      const locked = await this.inventory.lockEvent(tx, eventId);
      if (!locked) {
        return;
      }
      const fresh = await tx.event.findUnique({ where: { id: eventId } });
      if (!fresh || fresh.deletedAt) {
        return;
      }
      const open = await tx.booking.count({
        where: {
          eventId,
          status: { in: [BookingStatus.HELD, BookingStatus.PAID] },
        },
      });
      if (open > 0) {
        throw conflict(
          'Event still has open reservations',
          ErrorCode.EVENT_HAS_OPEN_BOOKINGS,
        );
      }
      await tx.event.update({
        where: { id: eventId },
        data: { deletedAt: new Date() },
      });
    });
  }

  async settleReservations(eventId: string): Promise<void> {
    const paid = await runWrite(this.prisma, async (tx) => {
      const locked = await this.inventory.lockEvent(tx, eventId);
      if (!locked) {
        throw notFound('Event not found', ErrorCode.EVENT_NOT_FOUND);
      }
      const event = await tx.event.findUnique({ where: { id: eventId } });
      if (!event || event.deletedAt) {
        throw notFound('Event not found', ErrorCode.EVENT_NOT_FOUND);
      }
      if (!event.salesClosedAt) {
        await tx.event.update({
          where: { id: eventId },
          data: { salesClosedAt: new Date() },
        });
      }
      await this.inventory.releaseExpiredHolds(tx, eventId, new Date());
      await this.cancelHeld(tx, eventId);
      return tx.booking.findMany({
        where: { eventId, status: BookingStatus.PAID },
      });
    });

    for (const booking of paid) {
      await this.refunds.refundBooking(booking);
    }
    if (paid.length === 0) {
      return;
    }

    await runWrite(this.prisma, async (tx) => {
      const locked = await this.inventory.lockEvent(tx, eventId);
      if (!locked) {
        throw notFound('Event not found', ErrorCode.EVENT_NOT_FOUND);
      }
      for (const booking of paid) {
        await applyPaidRefund(
          tx,
          {
            id: booking.id,
            eventId,
            quantity: booking.quantity,
          },
          'event_refunded',
        );
      }
    });
  }

  private async cancelHeld(tx: Tx, eventId: string): Promise<void> {
    const held = await tx.booking.findMany({
      where: { eventId, status: BookingStatus.HELD },
      select: { id: true, quantity: true },
    });
    if (held.length === 0) {
      return;
    }
    await tx.booking.updateMany({
      where: { eventId, status: BookingStatus.HELD },
      data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
    });
    await recordBookingTransitions(
      tx,
      held.map((row) => ({
        bookingId: row.id,
        fromStatus: BookingStatus.HELD,
        toStatus: BookingStatus.CANCELLED,
        reason: 'event_cancelled',
      })),
    );
    const quantity = held.reduce((sum, row) => sum + row.quantity, 0);
    await returnTickets(tx, eventId, quantity);
  }
}
