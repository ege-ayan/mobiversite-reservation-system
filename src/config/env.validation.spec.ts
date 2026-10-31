import { environmentSchema } from './env.validation.js';

describe('environmentSchema', () => {
  const valid = {
    DATABASE_URL: 'mysql://mobiversite:mobiversite@localhost:3306/mobiversite',
    JWT_SECRET: 'secret',
    PAYMENT_SERVICE_URL: 'http://localhost:4000/payments',
  };

  it('applies defaults and coerces numeric strings', () => {
    const parsed = environmentSchema.parse({
      ...valid,
      PORT: '3000',
      RESERVATION_HOLD_MS: '1800000',
    });

    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.PORT).toBe(3000);
    expect(parsed.JWT_EXPIRES_IN_SECONDS).toBe(86_400);
    expect(parsed.RESERVATION_HOLD_MS).toBe(1_800_000);
    expect(parsed.AUTH_RATE_LIMIT).toBe(10);
    expect(parsed.AUTH_RATE_TTL_MS).toBe(60_000);
    expect(parsed.BOOKING_RATE_LIMIT).toBe(30);
    expect(parsed.BOOKING_RATE_TTL_MS).toBe(60_000);
    expect(parsed.MAX_ACTIVE_TICKETS_PER_EVENT).toBe(10);
    expect(parsed.RATE_LIMIT_STORE).toBe('memory');
    expect(parsed.REDIS_URL).toBeUndefined();
  });

  it('ignores an empty Redis URL in memory mode', () => {
    const parsed = environmentSchema.parse({ ...valid, REDIS_URL: '' });

    expect(parsed.RATE_LIMIT_STORE).toBe('memory');
    expect(parsed.REDIS_URL).toBeUndefined();
  });

  it('requires REDIS_URL when the rate limit store is redis', () => {
    const missing = environmentSchema.safeParse({
      ...valid,
      RATE_LIMIT_STORE: 'redis',
    });
    const present = environmentSchema.parse({
      ...valid,
      RATE_LIMIT_STORE: 'redis',
      REDIS_URL: 'redis://localhost:6379',
    });

    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(
        missing.error.issues.some((issue) => issue.path[0] === 'REDIS_URL'),
      ).toBe(true);
    }
    expect(present.RATE_LIMIT_STORE).toBe('redis');
    expect(present.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('rejects a short JWT secret in production', () => {
    const result = environmentSchema.safeParse({
      ...valid,
      NODE_ENV: 'production',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a missing required variable', () => {
    const result = environmentSchema.safeParse({
      JWT_SECRET: 'secret',
      PAYMENT_SERVICE_URL: 'http://localhost:4000/payments',
    });

    expect(result.success).toBe(false);
  });
});
