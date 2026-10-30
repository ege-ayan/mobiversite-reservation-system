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
  });

  it('rejects a missing required variable', () => {
    const result = environmentSchema.safeParse({
      JWT_SECRET: 'secret',
      PAYMENT_SERVICE_URL: 'http://localhost:4000/payments',
    });

    expect(result.success).toBe(false);
  });
});
