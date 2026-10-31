import { BookingExpiry } from './booking-expiry.js';
import { BookingsService } from './bookings.service.js';

describe('BookingExpiry', () => {
  it('releases expired holds and then reconciles payments', async () => {
    const bookings = {
      releaseExpiredHolds: vi.fn().mockResolvedValue(3),
      reconcilePayments: vi.fn().mockResolvedValue(1),
    };

    await new BookingExpiry(bookings as unknown as BookingsService).sweep();

    expect(bookings.releaseExpiredHolds).toHaveBeenCalledOnce();
    expect(bookings.reconcilePayments).toHaveBeenCalledOnce();
  });
});
