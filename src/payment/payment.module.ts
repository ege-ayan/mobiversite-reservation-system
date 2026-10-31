import { Module } from '@nestjs/common';
import { BookingQueryModule } from '../bookings/booking-query.module.js';
import { SweepLock } from '../common/locking/mysql-lock.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ChargeService } from './charge.service.js';
import { PAYMENT_GATEWAY, PaymentClient } from './payment.client.js';
import { RefundService } from './refund.service.js';

@Module({
  imports: [InventoryModule, BookingQueryModule],
  providers: [
    PaymentClient,
    { provide: PAYMENT_GATEWAY, useExisting: PaymentClient },
    RefundService,
    ChargeService,
    SweepLock,
  ],
  exports: [PAYMENT_GATEWAY, RefundService, ChargeService, SweepLock],
})
export class PaymentModule {}
