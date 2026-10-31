import { createHmac, timingSafeEqual } from 'node:crypto';

export function signPaymentWebhook(secret: string, raw: Buffer | string) {
  return createHmac('sha256', secret).update(raw).digest('hex');
}

export function verifyPaymentWebhook(
  secret: string,
  raw: Buffer,
  signature: string | undefined,
) {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) {
    return false;
  }
  const expected = signPaymentWebhook(secret, raw);
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(signature, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
