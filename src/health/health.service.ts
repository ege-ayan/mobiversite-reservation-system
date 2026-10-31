import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { PrismaService } from '@/prisma/prisma.service.js';
import { RATE_LIMIT_STORAGE } from '@/rate-limit/rate-limit.storage.js';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RATE_LIMIT_STORAGE)
    private readonly rateLimit: { ping(): Promise<void> },
  ) {}

  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database is unavailable');
    }
    try {
      await this.rateLimit.ping();
    } catch {
      throw new ServiceUnavailableException('Rate limit store is unavailable');
    }
    return { status: 'ok' };
  }
}
