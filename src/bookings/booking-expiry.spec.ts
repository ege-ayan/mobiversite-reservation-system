import { BookingExpiry } from './booking-expiry.js';
import { BookingsService } from './bookings.service.js';

describe('BookingExpiry', () => {
  it('asks the booking service to release expired holds', async () => {
    const bookings = {
      releaseExpiredHolds: vi.fn().mockResolvedValue(3),
    };

    await expect(
      new BookingExpiry(
        bookings as unknown as BookingsService,
      ).releaseExpiredHolds(),
    ).resolves.toBe(3);
    expect(bookings.releaseExpiredHolds).toHaveBeenCalledOnce();
  });
});
