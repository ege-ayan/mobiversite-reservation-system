import { z } from 'zod';

function envBoolean(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (value === undefined || value === '') {
      return defaultValue;
    }
    if (value === true || value === 'true' || value === '1') {
      return true;
    }
    if (value === false || value === 'false' || value === '0') {
      return false;
    }
    return value;
  }, z.boolean());
}

export const developmentJwtSecret =
  '1234567891011121314151617181920212223242526272829303132';

export const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    DATABASE_URL: z.url(),
    JWT_SECRET: z.preprocess(
      (value) => (value === undefined || value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(86_400),
    PAYMENT_SERVICE_URL: z.url(),
    RESERVATION_HOLD_MS: z.coerce.number().int().positive().default(1_800_000),
    AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(10),
    AUTH_RATE_TTL_MS: z.coerce.number().int().positive().default(60_000),
    BOOKING_RATE_LIMIT: z.coerce.number().int().positive().default(30),
    BOOKING_RATE_TTL_MS: z.coerce.number().int().positive().default(60_000),
    MAX_ACTIVE_TICKETS_PER_EVENT: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10),
    PAYMENT_WEBHOOK_SECRET: z.string().min(16).default('dev-webhook-secret'),
    REFRESH_TOKEN_EXPIRES_IN_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(604_800),
    RATE_LIMIT_STORE: z.enum(['memory', 'redis']).default('memory'),
    REDIS_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.url().optional(),
    ),
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(200).default(20),
    RUN_JOBS: envBoolean(true),
    SWAGGER_ENABLED: z.preprocess(
      (value) => (value === undefined || value === '' ? undefined : value),
      z.enum(['true', 'false']).optional(),
    ),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && value.JWT_SECRET === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET is required in production',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      value.JWT_SECRET !== undefined &&
      value.JWT_SECRET.length < 32
    ) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET must be at least 32 characters in production',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      value.PAYMENT_WEBHOOK_SECRET.length < 32
    ) {
      context.addIssue({
        code: 'custom',
        path: ['PAYMENT_WEBHOOK_SECRET'],
        message:
          'PAYMENT_WEBHOOK_SECRET must be at least 32 characters in production',
      });
    }
    if (value.RATE_LIMIT_STORE === 'redis' && value.REDIS_URL === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required when RATE_LIMIT_STORE is redis',
      });
    }
  })
  .transform((value) => ({
    ...value,
    JWT_SECRET: value.JWT_SECRET ?? developmentJwtSecret,
    SWAGGER_ENABLED:
      value.SWAGGER_ENABLED === undefined
        ? value.NODE_ENV !== 'production'
        : value.SWAGGER_ENABLED === 'true',
  }));

export type EnvironmentVariables = z.infer<typeof environmentSchema>;
