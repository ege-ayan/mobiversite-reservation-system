import { Module } from '@nestjs/common';

import { InventoryModule } from '@/inventory/inventory.module.js';
import { PaymentModule } from '@/payment/payment.module.js';
import { RateLimitModule } from '@/rate-limit/rate-limit.module.js';

import { BookingQueryModule } from './booking-query.module.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { ChargeService } from './charge.service.js';
import { ExpiryService } from './expiry.service.js';
import { ReservationService } from './reservation.service.js';

@Module({
  imports: [
    InventoryModule,
    PaymentModule,
    RateLimitModule,
    BookingQueryModule,
  ],
  controllers: [BookingsController],
  providers: [
    BookingsService,
    ReservationService,
    ExpiryService,
    ChargeService,
  ],
  exports: [BookingsService, ChargeService],
})
export class BookingsModule {}
