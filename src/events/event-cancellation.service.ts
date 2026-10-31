import { Injectable, Logger } from '@nestjs/common';
import { conflict, notFound } from '../common/errors/app.exception.js';
import { BookingStatus, Prisma } from '../generated/prisma/client.js';
import { recordBookingTransitions } from '../bookings/booking-history.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { RefundService } from '../payment/refund.service.js';
import { WRITE_TRANSACTION } from '../prisma/transaction.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { EventCancellationResponse } from './dto/event-cancellation-response.js';

const CANCELLATION_BATCH = 50;

type Tx = Prisma.TransactionClient;

@Injectable()
export class EventCancellationService {
  private readonly logger = new Logger(EventCancellationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly refunds: RefundService,
  ) {}

  async request(eventId: string): Promise<EventCancellationResponse> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.inventory.lockEvent(tx, eventId);
      if (!locked) {
        throw notFound('Event not found', 'EVENT_NOT_FOUND');
      }
      const event = await tx.event.findUnique({ where: { id: eventId } });
      if (!event || event.deletedAt) {
        throw notFound('Event not found', 'EVENT_NOT_FOUND');
      }
      if (!event.salesClosedAt) {
        await tx.event.update({
          where: { id: eventId },
          data: { salesClosedAt: new Date() },
        });
      }
    }, WRITE_TRANSACTION);
    return { id: eventId, status: 'CANCELLING' };
  }

  async processPending(): Promise<number> {
    const events = await this.prisma.event.findMany({
      where: { salesClosedAt: { not: null }, deletedAt: null },
      select: { id: true },
      take: CANCELLATION_BATCH,
    });
    let count = 0;
    for (const event of events) {
      try {
        await this.processOne(event.id);
        count += 1;
      } catch (error) {
        this.logger.error(
          `Failed to finish cancellation for event ${event.id}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    return count;
  }

  async processOne(eventId: string): Promise<void> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event || event.deletedAt || !event.salesClosedAt) {
      return;
    }
    await this.settleReservations(eventId);
    await this.prisma.$transaction(async (tx) => {
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
          'EVENT_HAS_OPEN_BOOKINGS',
        );
      }
      await tx.event.update({
        where: { id: eventId },
        data: { deletedAt: new Date() },
      });
    }, WRITE_TRANSACTION);
  }

  async settleReservations(eventId: string): Promise<void> {
    const paid = await this.prisma.$transaction(async (tx) => {
      const locked = await this.inventory.lockEvent(tx, eventId);
      if (!locked) {
        throw notFound('Event not found', 'EVENT_NOT_FOUND');
      }
      const event = await tx.event.findUnique({ where: { id: eventId } });
      if (!event || event.deletedAt) {
        throw notFound('Event not found', 'EVENT_NOT_FOUND');
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
    }, WRITE_TRANSACTION);

    for (const booking of paid) {
      await this.refunds.refundBooking(booking);
    }
    if (paid.length === 0) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const locked = await this.inventory.lockEvent(tx, eventId);
      if (!locked) {
        throw notFound('Event not found', 'EVENT_NOT_FOUND');
      }
      for (const booking of paid) {
        const updated = await tx.booking.updateMany({
          where: { id: booking.id, status: BookingStatus.PAID },
          data: { status: BookingStatus.REFUNDED, refundedAt: new Date() },
        });
        if (updated.count === 1) {
          await recordBookingTransitions(tx, [
            {
              bookingId: booking.id,
              fromStatus: BookingStatus.PAID,
              toStatus: BookingStatus.REFUNDED,
              reason: 'event_refunded',
            },
          ]);
          await tx.event.update({
            where: { id: eventId },
            data: { availableTickets: { increment: booking.quantity } },
          });
        }
      }
    }, WRITE_TRANSACTION);
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
    await tx.event.update({
      where: { id: eventId },
      data: { availableTickets: { increment: quantity } },
    });
  }
}
