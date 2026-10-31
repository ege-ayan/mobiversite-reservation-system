import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { BookingsService } from '@/bookings/bookings.service.js';
import type { EnvironmentVariables } from '@/config/env.validation.js';
import { EventCancellationService } from '@/events/event-cancellation.service.js';

@Injectable()
export class ReservationScheduler {
  private readonly logger = new Logger(ReservationScheduler.name);
  private readonly jobsEnabled: boolean;

  constructor(
    private readonly bookings: BookingsService,
    private readonly cancellation: EventCancellationService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.jobsEnabled = config.get('RUN_JOBS', { infer: true });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async releaseExpiredHolds(): Promise<void> {
    if (!this.jobsEnabled) {
      return;
    }
    try {
      await this.bookings.releaseExpiredHolds();
    } catch (error) {
      this.logger.error(
        'Failed to release expired holds',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async reconcilePayments(): Promise<void> {
    if (!this.jobsEnabled) {
      return;
    }
    try {
      await this.bookings.reconcilePayments();
    } catch (error) {
      this.logger.error(
        'Failed to reconcile payments',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async finishCancellations(): Promise<void> {
    if (!this.jobsEnabled) {
      return;
    }
    try {
      await this.cancellation.processPending();
    } catch (error) {
      this.logger.error(
        'Failed to finish event cancellations',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
