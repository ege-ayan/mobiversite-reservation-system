import { describe, expect, it } from 'vitest';
import {
  signPaymentWebhook,
  verifyPaymentWebhook,
} from './payment-signature.js';

describe('payment webhook signature', () => {
  const secret = 'dev-webhook-secret';
  const raw = Buffer.from('{"idempotencyKey":"booking-1","paid":true}');

  it('accepts the hex HMAC of the raw body', () => {
    const signature = signPaymentWebhook(secret, raw);
    expect(verifyPaymentWebhook(secret, raw, signature)).toBe(true);
    expect(verifyPaymentWebhook(secret, raw, signature.toUpperCase())).toBe(
      true,
    );
  });

  it('rejects a missing, short, or mismatched signature', () => {
    expect(verifyPaymentWebhook(secret, raw, undefined)).toBe(false);
    expect(verifyPaymentWebhook(secret, raw, 'abcd')).toBe(false);
    expect(verifyPaymentWebhook(secret, raw, 'a'.repeat(64))).toBe(false);
    const tampered = Buffer.from('{"idempotencyKey":"booking-1","paid":false}');
    expect(
      verifyPaymentWebhook(secret, tampered, signPaymentWebhook(secret, raw)),
    ).toBe(false);
  });
});
