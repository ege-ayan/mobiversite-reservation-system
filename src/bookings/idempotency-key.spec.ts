import { BadRequestException } from '@nestjs/common';

import { parseIdempotencyKey, requestFingerprint } from './idempotency-key.js';

describe('parseIdempotencyKey', () => {
  it('treats a missing header as an ordinary reservation', () => {
    expect(parseIdempotencyKey(undefined)).toBeUndefined();
  });

  it('accepts a single token', () => {
    expect(parseIdempotencyKey('hold-8f14e45f')).toBe('hold-8f14e45f');
  });

  it('rejects a blank, spaced, or repeated header', () => {
    expect(() => parseIdempotencyKey('')).toThrow(BadRequestException);
    expect(() => parseIdempotencyKey('has space')).toThrow(BadRequestException);
    expect(() => parseIdempotencyKey(['one', 'two'])).toThrow(
      BadRequestException,
    );
  });
});

describe('requestFingerprint', () => {
  it('changes when the event or quantity changes', () => {
    const first = requestFingerprint('event-id', 1);
    expect(requestFingerprint('event-id', 1)).toBe(first);
    expect(requestFingerprint('event-id', 2)).not.toBe(first);
    expect(requestFingerprint('other-event', 1)).not.toBe(first);
  });
});
