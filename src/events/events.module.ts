import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module.js';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';

@Module({
  imports: [BookingsModule],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
