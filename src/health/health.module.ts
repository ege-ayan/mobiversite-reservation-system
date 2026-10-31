import { Module } from '@nestjs/common';
import { RateLimitStorageModule } from '../rate-limit/rate-limit.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  imports: [RateLimitStorageModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
