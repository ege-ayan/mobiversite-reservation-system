import { RedisRateLimitStorage } from './redis-rate-limit.storage.js';
import type { RateLimitRedis } from './redis-rate-limit.storage.js';

function fakeRedis(result: unknown) {
  const evalCommand = vi.fn().mockResolvedValue(result);
  const quit = vi.fn().mockResolvedValue('OK');
  const disconnect = vi.fn();
  const redis: RateLimitRedis = {
    status: 'ready',
    eval: evalCommand,
    quit,
    disconnect,
    ping: vi.fn().mockResolvedValue('PONG'),
  };
  return { redis, evalCommand, quit, disconnect };
}

describe('RedisRateLimitStorage', () => {
  it('maps a successful hit from the Redis script', async () => {
    const { redis, evalCommand } = fakeRedis([1, 60, 0, 0]);
    const storage = new RedisRateLimitStorage(redis);

    await expect(
      storage.increment('tracker', 60_000, 10, 60_000, 'default'),
    ).resolves.toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });

    expect(evalCommand).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      2,
      'mobiversite:rate:{default:tracker}',
      'mobiversite:rate:{default:tracker}:block',
      60_000,
      10,
      60_000,
    );
  });

  it('maps a blocked hit', async () => {
    const { redis } = fakeRedis(['11', '12', '1', '12']);
    const storage = new RedisRateLimitStorage(redis);

    await expect(
      storage.increment('tracker', 60_000, 10, 60_000, 'default'),
    ).resolves.toEqual({
      totalHits: 11,
      timeToExpire: 12,
      isBlocked: true,
      timeToBlockExpire: 12,
    });
  });

  it('rejects a script result that is not four numbers', async () => {
    const { redis } = fakeRedis(['nope']);
    const storage = new RedisRateLimitStorage(redis);

    await expect(
      storage.increment('tracker', 60_000, 10, 60_000, 'default'),
    ).rejects.toThrow('Unexpected Redis rate-limit response');
  });

  it('closes the client once', async () => {
    const { redis, quit } = fakeRedis([1, 60, 0, 0]);
    const storage = new RedisRateLimitStorage(redis);

    await storage.onApplicationShutdown();
    await storage.onApplicationShutdown();

    expect(quit).toHaveBeenCalledOnce();
  });

  it('disconnects a client that never connected', async () => {
    const { redis, quit, disconnect } = fakeRedis([1, 60, 0, 0]);
    redis.status = 'wait';
    const storage = new RedisRateLimitStorage(redis);

    await storage.onApplicationShutdown();

    expect(disconnect).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();
  });
});
