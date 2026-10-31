import { createHash } from 'node:crypto';
import { badRequest } from '../common/errors/app.exception.js';

const KEY_PATTERN = /^[\w.:-]{1,255}$/;

export function parseIdempotencyKey(
  header: string | string[] | undefined,
): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const values = Array.isArray(header) ? header : [header];
  const key = values[0];
  if (values.length !== 1 || key === undefined || !KEY_PATTERN.test(key)) {
    throw badRequest('Invalid idempotency key', 'INVALID_IDEMPOTENCY_KEY');
  }
  return key;
}

export function requestFingerprint(eventId: string, quantity: number): string {
  return createHash('sha256').update(`${eventId}:${quantity}`).digest('hex');
}
