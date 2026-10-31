import { Injectable, NotFoundException } from '@nestjs/common';
import { recordBookingTransitions } from '../bookings/booking-history.js';
import { returnTickets } from '../bookings/booking-lifecycle.js';
import { BookingStatus, Prisma } from '../generated/prisma/client.js';
import { runWrite } from '../prisma/retry.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type InventoryTransaction = Prisma.TransactionClient;

type HeldTicket = { id: string; quantity: number };

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async reclaim(eventId: string, now = new Date()): Promise<number> {
    return runWrite(this.prisma, async (tx) => {
      const locked = await this.lockEvent(tx, eventId);
      if (!locked) {
        throw new NotFoundException('Event not found');
      }
      return this.releaseExpiredHolds(tx, eventId, now);
    });
  }

  async lockEvent(tx: InventoryTransaction, eventId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM events WHERE id = ${eventId} FOR UPDATE
    `;
    return rows.length > 0;
  }

  async releaseExpiredHolds(
    tx: InventoryTransaction,
    eventId: string,
    now: Date,
  ): Promise<number> {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { startsAt: true },
    });

    const cutoff =
      event && event.startsAt.getTime() <= now.getTime()
        ? new Date('9999-12-31T00:00:00.000Z')
        : now;
    const due = await tx.$queryRaw<HeldTicket[]>`
      SELECT id, quantity
      FROM bookings
      WHERE event_id = ${eventId}
        AND status = 'HELD'
        AND expires_at <= ${cutoff}
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
      },
      data: { status: BookingStatus.EXPIRED },
    });
    if (updated.count !== due.length) {
      throw new Error('Expired hold set changed during release');
    }
    await recordBookingTransitions(
      tx,
      due.map((row) => ({
        bookingId: row.id,
        fromStatus: BookingStatus.HELD,
        toStatus: BookingStatus.EXPIRED,
        reason: 'expired',
      })),
    );

    const quantity = due.reduce((sum, row) => sum + Number(row.quantity), 0);
    await returnTickets(tx, eventId, quantity);
    return due.length;
  }
}
