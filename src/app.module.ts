import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthController } from './auth/auth.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { BookingsController } from './bookings/bookings.controller.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { RequestLoggingMiddleware } from './common/logging/request-logging.middleware.js';
import { environmentSchema } from './config/env.validation.js';
import { EventsController } from './events/events.controller.js';
import { EventsModule } from './events/events.module.js';
import { HealthController } from './health/health.controller.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    HealthModule,
    AuthModule,
    EventsModule,
    BookingsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestLoggingMiddleware)
      .forRoutes(
        AuthController,
        BookingsController,
        EventsController,
        HealthController,
      );
  }
}
