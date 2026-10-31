import { Module } from '@nestjs/common';

import { PAYMENT_GATEWAY, PaymentClient } from './payment.client.js';
import { RefundService } from './refund.service.js';

@Module({
  providers: [
    PaymentClient,
    { provide: PAYMENT_GATEWAY, useExisting: PaymentClient },
    RefundService,
  ],
  exports: [PAYMENT_GATEWAY, RefundService],
})
export class PaymentModule {}
