import { OnApplicationShutdown } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Redis } from 'ioredis';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

export interface RateLimitRedis {
  eval(
    script: string,
    numkeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  quit(): Promise<unknown>;
  disconnect(): void;
  ping(): Promise<string>;
  status: string;
}

const INCREMENT_SCRIPT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

local blockedFor = redis.call('PTTL', blockKey)
if blockedFor > 0 then
  local hits = tonumber(redis.call('GET', hitsKey) or '0')
  local ttlLeft = redis.call('PTTL', hitsKey)
  if ttlLeft < 0 then ttlLeft = 0 end
  return { hits, math.ceil(ttlLeft / 1000), 1, math.ceil(blockedFor / 1000) }
end

local hits = redis.call('INCR', hitsKey)
if hits == 1 then
  redis.call('PEXPIRE', hitsKey, ttl)
end
local ttlLeft = redis.call('PTTL', hitsKey)
if ttlLeft < 0 then
  redis.call('PEXPIRE', hitsKey, ttl)
  ttlLeft = ttl
end

local isBlocked = 0
local blockLeft = 0
if hits > limit then
  local blockMs = blockDuration
  if blockMs <= 0 then blockMs = ttlLeft end
  redis.call('SET', blockKey, '1', 'PX', blockMs)
  isBlocked = 1
  blockLeft = math.ceil(blockMs / 1000)
end

return { hits, math.ceil(ttlLeft / 1000), isBlocked, blockLeft }
`;

export class RedisRateLimitStorage
  implements ThrottlerStorage, OnApplicationShutdown
{
  private closed = false;

  constructor(private readonly redis: RateLimitRedis) {}

  static connect(url: string): RedisRateLimitStorage {
    return new RedisRateLimitStorage(
      new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 2,
      }),
    );
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const slot = `{${throttlerName}:${key}}`;
    const hitsKey = `mobiversite:auth-rate:${slot}`;
    const blockKey = `mobiversite:auth-rate:${slot}:block`;
    const result = await this.redis.eval(
      INCREMENT_SCRIPT,
      2,
      hitsKey,
      blockKey,
      ttl,
      limit,
      blockDuration,
    );
    return toRecord(result);
  }

  async ping(): Promise<void> {
    const reply = await this.redis.ping();
    if (reply !== 'PONG') {
      throw new Error('Redis did not respond');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.redis.status === 'wait' || this.redis.status === 'end') {
      this.redis.disconnect();
      return;
    }
    await this.redis.quit();
  }
}

function toRecord(value: unknown): ThrottlerStorageRecord {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error('Unexpected Redis rate-limit response');
  }
  const totalHits = readNumber(value[0]);
  const timeToExpire = readNumber(value[1]);
  const blocked = readNumber(value[2]);
  const timeToBlockExpire = readNumber(value[3]);
  return {
    totalHits,
    timeToExpire,
    isBlocked: blocked === 1,
    timeToBlockExpire,
  };
}

function readNumber(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error('Unexpected Redis rate-limit response');
  }
  return number;
}
