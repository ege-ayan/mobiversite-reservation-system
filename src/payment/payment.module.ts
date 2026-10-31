import { Module } from '@nestjs/common';
import { PAYMENT_GATEWAY, PaymentClient } from './payment.client.js';

@Module({
  providers: [
    PaymentClient,
    { provide: PAYMENT_GATEWAY, useExisting: PaymentClient },
  ],
  exports: [PAYMENT_GATEWAY],
})
export class PaymentModule {}
