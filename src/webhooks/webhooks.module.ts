import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module.js';
import { PaymentWebhookController } from './payment-webhook.controller.js';
import { PaymentWebhookService } from './payment-webhook.service.js';

@Module({
  imports: [PaymentModule],
  controllers: [PaymentWebhookController],
  providers: [PaymentWebhookService],
})
export class WebhooksModule {}
