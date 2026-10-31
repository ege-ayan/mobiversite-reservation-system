import {
  ThrottlerStorageService,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { RedisRateLimitStorage } from './redis-rate-limit.storage.js';

export const RATE_LIMIT_STORAGE = Symbol('RATE_LIMIT_STORAGE');

export function createRateLimitStorage(options: {
  store: 'memory' | 'redis';
  redisUrl?: string;
}): ThrottlerStorage {
  if (options.store === 'memory') {
    return new ThrottlerStorageService();
  }
  if (!options.redisUrl) {
    throw new Error('REDIS_URL is required when RATE_LIMIT_STORE is redis');
  }
  return RedisRateLimitStorage.connect(options.redisUrl);
}
