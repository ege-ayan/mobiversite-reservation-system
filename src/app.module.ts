import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { LockingModule } from './common/locking/locking.module.js';
import { loggerModule } from './common/logging/logger.module.js';
import { environmentSchema } from './config/env.validation.js';
import { EventsModule } from './events/events.module.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SchedulerModule } from './scheduler/scheduler.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';

@Module({
  imports: [
    loggerModule,
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    LockingModule,
    HealthModule,
    AuthModule,
    EventsModule,
    BookingsModule,
    SchedulerModule,
    WebhooksModule,
  ],
})
export class AppModule {}
