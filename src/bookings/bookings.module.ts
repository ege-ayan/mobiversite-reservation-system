import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PaymentModule } from '../payment/payment.module.js';
import { BookingExpiry } from './booking-expiry.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { SweepLock } from './sweep-lock.js';

@Module({
  imports: [InventoryModule, PaymentModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingExpiry, SweepLock],
  exports: [BookingsService],
})
export class BookingsModule {}
