import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PaymentModule } from '../payment/payment.module.js';
import { EventCancellationService } from './event-cancellation.service.js';

@Module({
  imports: [InventoryModule, PaymentModule],
  providers: [EventCancellationService],
  exports: [EventCancellationService],
})
export class EventCancellationModule {}
