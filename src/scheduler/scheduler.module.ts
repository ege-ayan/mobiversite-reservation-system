import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module.js';
import { EventCancellationModule } from '../events/event-cancellation.module.js';
import { ReservationScheduler } from './reservation.scheduler.js';

@Module({
  imports: [BookingsModule, EventCancellationModule],
  providers: [ReservationScheduler],
})
export class SchedulerModule {}
