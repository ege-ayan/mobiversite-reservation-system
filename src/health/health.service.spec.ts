import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { PrismaService } from '@/prisma/prisma.service.js';
import { RATE_LIMIT_STORAGE } from '@/rate-limit/rate-limit.storage.js';

import { HealthService } from './health.service.js';

describe('HealthService', () => {
  let service: HealthService;
  const prisma = { $queryRaw: vi.fn() };
  const rateLimit = { ping: vi.fn() };

  beforeEach(async () => {
    prisma.$queryRaw.mockReset();
    rateLimit.ping.mockReset();
    rateLimit.ping.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
        { provide: RATE_LIMIT_STORAGE, useValue: rateLimit },
      ],
    }).compile();

    service = moduleRef.get(HealthService);
  });

  it('reports ok when the database answers', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '1': 1 }]);

    await expect(service.check()).resolves.toEqual({ status: 'ok' });
  });

  it('reports unavailable when the database cannot be reached', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    await expect(service.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('reports unavailable when the rate limit store cannot be reached', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '1': 1 }]);
    rateLimit.ping.mockRejectedValue(new Error('redis down'));

    await expect(service.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
