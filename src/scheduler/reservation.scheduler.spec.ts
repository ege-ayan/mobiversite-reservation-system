import { ReservationScheduler } from './reservation.scheduler.js';
import { BookingsService } from '../bookings/bookings.service.js';
import { EventCancellationService } from '../events/event-cancellation.service.js';

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
    bookings.releaseExpiredHolds.mockRejectedValue(new Error('lock failed'));

    await expect(scheduler.releaseExpiredHolds()).resolves.toBeUndefined();
    await expect(scheduler.reconcilePayments()).resolves.toBeUndefined();

    expect(bookings.reconcilePayments).toHaveBeenCalledOnce();
  });
});
