import {
  BookingStatus,
  PaymentState,
  Prisma,
} from '../generated/prisma/client.js';
import { recordBookingTransition } from './booking-history.js';

type Tx = Prisma.TransactionClient;

export async function returnTickets(
  tx: Tx,
  eventId: string,
  quantity: number,
): Promise<void> {
  if (quantity <= 0) {
    return;
  }
  await tx.event.update({
    where: { id: eventId },
    data: { availableTickets: { increment: quantity } },
  });
}

export async function applyPaidRefund(
  tx: Tx,
  booking: {
    id: string;
    userId?: string;
    eventId: string;
    quantity: number;
  },
  reason: 'refunded' | 'event_refunded',
): Promise<'refunded' | 'already' | 'closed'> {
  const updated = await tx.booking.updateMany({
    where: {
      id: booking.id,
      status: BookingStatus.PAID,
      ...(booking.userId ? { userId: booking.userId } : {}),
    },
    data: { status: BookingStatus.REFUNDED, refundedAt: new Date() },
  });
  if (updated.count === 1) {
    await recordBookingTransition(tx, {
      bookingId: booking.id,
      fromStatus: BookingStatus.PAID,
      toStatus: BookingStatus.REFUNDED,
      reason,
    });
    await returnTickets(tx, booking.eventId, booking.quantity);
    await markRefundAttempts(tx, booking.id);
    return 'refunded';
  }
  const current = await tx.booking.findFirst({
    where: {
      id: booking.id,
      ...(booking.userId ? { userId: booking.userId } : {}),
    },
    select: { status: true },
  });
  if (current?.status === BookingStatus.REFUNDED) {
    await markRefundAttempts(tx, booking.id);
    return 'already';
  }
  return 'closed';
}

async function markRefundAttempts(tx: Tx, bookingId: string): Promise<void> {
  await tx.paymentAttempt.updateMany({
    where: {
      bookingId,
      state: {
        in: [
          PaymentState.REFUND_DUE,
          PaymentState.APPLIED,
          PaymentState.PENDING,
        ],
      },
    },
    data: { state: PaymentState.REFUNDED },
  });
}
