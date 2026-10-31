import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule, type ThrottlerStorage } from '@nestjs/throttler';
import type { EnvironmentVariables } from '../config/env.validation.js';
import {
  RATE_LIMIT_STORAGE,
  createRateLimitStorage,
} from './rate-limit.storage.js';

@Module({
  providers: [
    {
      provide: RATE_LIMIT_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        createRateLimitStorage({
          store: config.get('RATE_LIMIT_STORE', { infer: true }),
          redisUrl: config.get('REDIS_URL', { infer: true }),
        }),
    },
  ],
  exports: [RATE_LIMIT_STORAGE],
})
export class RateLimitStorageModule {}

@Module({
  imports: [
    RateLimitStorageModule,
    ThrottlerModule.forRootAsync({
      imports: [RateLimitStorageModule],
      inject: [ConfigService, RATE_LIMIT_STORAGE],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
        storage: ThrottlerStorage,
      ) => ({
        throttlers: [
          {
            ttl: config.get('AUTH_RATE_TTL_MS', { infer: true }),
            limit: config.get('AUTH_RATE_LIMIT', { infer: true }),
          },
        ],
        storage,
      }),
    }),
  ],
  exports: [ThrottlerModule],
})
export class RateLimitModule {}
