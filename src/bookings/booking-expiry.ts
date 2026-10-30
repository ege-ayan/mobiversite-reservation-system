import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingsService } from './bookings.service.js';

@Injectable()
export class BookingExpiry {
  constructor(private readonly bookings: BookingsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  releaseExpiredHolds(): Promise<number> {
    return this.bookings.releaseExpiredHolds();
  }
}
