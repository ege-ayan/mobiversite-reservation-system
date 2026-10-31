import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { badRequest, unauthorized } from '../common/errors/app.exception.js';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { ChargeService } from '../bookings/charge.service.js';
import { verifyPaymentWebhook } from './payment-signature.js';

const webhookBody = z.object({
  idempotencyKey: z.string().min(1).max(255),
  paid: z.boolean(),
});

@Injectable()
export class PaymentWebhookService {
  constructor(
    private readonly charges: ChargeService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async receive(raw: Buffer | undefined, signature: string | undefined) {
    if (!raw) {
      throw badRequest('Missing webhook body', 'INVALID_WEBHOOK');
    }
    const secret = this.config.get('PAYMENT_WEBHOOK_SECRET', { infer: true });
    if (!verifyPaymentWebhook(secret, raw, signature)) {
      throw unauthorized(
        'Invalid webhook signature',
        'INVALID_WEBHOOK_SIGNATURE',
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      throw badRequest('Webhook body must be JSON', 'INVALID_WEBHOOK');
    }
    const body = webhookBody.safeParse(parsed);
    if (!body.success) {
      throw badRequest('Webhook body is invalid', 'INVALID_WEBHOOK');
    }
    await this.charges.applyProviderResult(
      body.data.idempotencyKey,
      body.data.paid,
    );
  }
}
