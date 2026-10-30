import { Module } from '@nestjs/common';
import { BookingExpiry } from './booking-expiry.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { PaymentClient } from './payment.client.js';

@Module({
  controllers: [BookingsController],
  providers: [BookingsService, PaymentClient, BookingExpiry],
  exports: [BookingsService],
})
export class BookingsModule {}
