import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  let service: HealthService;
  const prisma = { $queryRaw: vi.fn() };

  beforeEach(async () => {
    prisma.$queryRaw.mockReset();

    const moduleRef = await Test.createTestingModule({
      providers: [HealthService, { provide: PrismaService, useValue: prisma }],
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
});
