import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

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
    throw new BadRequestException('Invalid idempotency key');
  }
  return key;
}

export function requestFingerprint(eventId: string, quantity: number): string {
  return createHash('sha256').update(`${eventId}:${quantity}`).digest('hex');
}
