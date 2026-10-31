import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BookingsService } from '@/bookings/bookings.service.js';
import type { EnvironmentVariables } from '@/config/env.validation.js';
import { EventCancellationService } from '@/events/event-cancellation.service.js';

import { ReservationScheduler } from './reservation.scheduler.js';

describe('ReservationScheduler', () => {
  const bookings = {
    releaseExpiredHolds: vi.fn().mockResolvedValue(3),
    reconcilePayments: vi.fn().mockResolvedValue(1),
  };
  const cancellation = {
    processPending: vi.fn().mockResolvedValue(1),
  };
  const scheduler = new ReservationScheduler(
    bookings as unknown as BookingsService,
    cancellation as unknown as EventCancellationService,
    { get: () => true } as unknown as ConfigService<EnvironmentVariables, true>,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    bookings.releaseExpiredHolds.mockResolvedValue(3);
    bookings.reconcilePayments.mockResolvedValue(1);
    cancellation.processPending.mockResolvedValue(1);
  });

  it('runs expiry, reconciliation, and cancellation independently', async () => {
    await scheduler.releaseExpiredHolds();
    await scheduler.reconcilePayments();
    await scheduler.finishCancellations();

    expect(bookings.releaseExpiredHolds).toHaveBeenCalledOnce();
    expect(bookings.reconcilePayments).toHaveBeenCalledOnce();
    expect(cancellation.processPending).toHaveBeenCalledOnce();
  });

  it('reconciles payments when the expiry sweep fails', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    bookings.releaseExpiredHolds.mockRejectedValue(new Error('lock failed'));

    await expect(scheduler.releaseExpiredHolds()).resolves.toBeUndefined();
    await expect(scheduler.reconcilePayments()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      'Failed to release expired holds',
      expect.stringContaining('lock failed'),
    );
    expect(bookings.reconcilePayments).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('does nothing when background jobs are disabled', async () => {
    const paused = new ReservationScheduler(
      bookings as unknown as BookingsService,
      cancellation as unknown as EventCancellationService,
      { get: () => false } as unknown as ConfigService<
        EnvironmentVariables,
        true
      >,
    );

    await paused.releaseExpiredHolds();
    await paused.reconcilePayments();
    await paused.finishCancellations();

    expect(bookings.releaseExpiredHolds).not.toHaveBeenCalled();
    expect(bookings.reconcilePayments).not.toHaveBeenCalled();
    expect(cancellation.processPending).not.toHaveBeenCalled();
  });
});
