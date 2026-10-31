import { toEventResponse } from '@/events/event-response.mapper.js';
import { BookingStatus, Prisma } from '@/generated/prisma/client.js';

import { amountOf } from './booking-amount.js';
import type { AdminBookingResponse } from './dto/admin-booking-response.js';
import type { BookingResponse } from './dto/booking-response.js';

export type BookingWithEvent = Prisma.BookingGetPayload<{
  include: { event: true };
}>;

type BookingWithCustomer = BookingWithEvent & { user: { email: string } };

export function toBookingResponse(
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
    totalAmount: amountOf(booking),
    expiresAt: booking.expiresAt,
    paidAt: booking.paidAt ?? null,
    cancelledAt: booking.cancelledAt ?? null,
    refundedAt: booking.refundedAt ?? null,
    createdAt: booking.createdAt,
    event: toEventResponse(booking.event),
  };
}

export function toAdminBookingResponse(
  booking: BookingWithCustomer,
  now = new Date(),
): AdminBookingResponse {
  const reservation = toBookingResponse(booking, now);
  return {
    id: reservation.id,
    eventId: reservation.eventId,
    quantity: reservation.quantity,
    status: reservation.status,
    ticketPrice: reservation.ticketPrice,
    totalAmount: reservation.totalAmount,
    expiresAt: reservation.expiresAt,
    paidAt: reservation.paidAt,
    cancelledAt: reservation.cancelledAt,
    refundedAt: reservation.refundedAt,
    createdAt: reservation.createdAt,
    event: reservation.event,
    userEmail: booking.user.email,
  };
}
