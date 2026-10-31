import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';

import { Public } from '@/auth/decorators/public.decorator.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { RATE_LIMIT_STORAGE } from '@/rate-limit/rate-limit.storage.js';

@Public()
@ApiTags('Health')
@Controller('health')
export class HealthProbesController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly prisma: PrismaService,
    @Inject(RATE_LIMIT_STORAGE)
    private readonly rateLimit: { ping(): Promise<void> },
  ) {}

  @Get('live')
  @HealthCheck()
  @ApiOperation({ summary: 'Process is up' })
  @ApiOkResponse({ description: 'Liveness' })
  live() {
    return this.health.check([() => this.indicators.check('process').up()]);
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Database and rate-limit store are reachable' })
  @ApiOkResponse({ description: 'Readiness' })
  ready() {
    return this.health.check([
      () =>
        this.indicators
          .check('database')
          .attempt(() => this.prisma.$queryRaw`SELECT 1`),
      () =>
        this.indicators.check('rateLimit').attempt(() => this.rateLimit.ping()),
    ]);
  }
}
