import type { BookingStatus } from '../generated/prisma/client.js';

export type BookingTransition = {
  bookingId: string;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
  reason: string;
};

type HistoryClient = {
  bookingEvent: {
    create: (args: { data: BookingTransition }) => Promise<unknown>;
    createMany: (args: { data: BookingTransition[] }) => Promise<unknown>;
  };
};

export async function recordBookingTransition(
  tx: HistoryClient,
  transition: BookingTransition,
): Promise<void> {
  await tx.bookingEvent.create({ data: transition });
}

export async function recordBookingTransitions(
  tx: HistoryClient,
  transitions: BookingTransition[],
): Promise<void> {
  if (transitions.length === 0) {
    return;
  }
  await tx.bookingEvent.createMany({ data: transitions });
}
