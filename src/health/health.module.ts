import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { RateLimitStorageModule } from '../rate-limit/rate-limit.module.js';
import { HealthController } from './health.controller.js';
import { HealthProbesController } from './health-probes.controller.js';
import { HealthService } from './health.service.js';

@Module({
  imports: [RateLimitStorageModule, TerminusModule],
  controllers: [HealthController, HealthProbesController],
  providers: [HealthService],
})
export class HealthModule {}
