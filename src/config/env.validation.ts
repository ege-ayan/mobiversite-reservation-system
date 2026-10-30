import { z } from 'zod';

export const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(1),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(86_400),
  PAYMENT_SERVICE_URL: z.url(),
  RESERVATION_HOLD_MS: z.coerce.number().int().positive().default(1_800_000),
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  AUTH_RATE_TTL_MS: z.coerce.number().int().positive().default(60_000),
});

export type EnvironmentVariables = z.infer<typeof environmentSchema>;
