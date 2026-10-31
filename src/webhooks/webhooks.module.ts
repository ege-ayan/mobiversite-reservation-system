import { Module } from '@nestjs/common';

import { BookingsModule } from '@/bookings/bookings.module.js';

import { PaymentWebhookController } from './payment-webhook.controller.js';
import { PaymentWebhookService } from './payment-webhook.service.js';

@Module({
  imports: [BookingsModule],
  controllers: [PaymentWebhookController],
  providers: [PaymentWebhookService],
})
export class WebhooksModule {}
