import { ThrottlerStorageService } from '@nestjs/throttler';
import { createRateLimitStorage } from './rate-limit.storage.js';
import { RedisRateLimitStorage } from './redis-rate-limit.storage.js';

describe('createRateLimitStorage', () => {
  it('uses the in-process counter by default', () => {
    expect(createRateLimitStorage({ store: 'memory' })).toBeInstanceOf(
      ThrottlerStorageService,
    );
  });

  it('opens a lazy Redis client when the store is redis', async () => {
    const storage = createRateLimitStorage({
      store: 'redis',
      redisUrl: 'redis://127.0.0.1:6399',
    });

    expect(storage).toBeInstanceOf(RedisRateLimitStorage);
    await (storage as RedisRateLimitStorage).onApplicationShutdown();
  });

  it('refuses redis without a URL', () => {
    expect(() => createRateLimitStorage({ store: 'redis' })).toThrow(
      'REDIS_URL is required when RATE_LIMIT_STORE is redis',
    );
  });
});
