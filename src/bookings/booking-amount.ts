import type { Prisma } from '../generated/prisma/client.js';

export function amountOf(booking: {
  ticketPrice: Prisma.Decimal;
  quantity: number;
}) {
  return booking.ticketPrice.mul(booking.quantity).toFixed(2);
}
