import { Module } from '@nestjs/common';
import { BookingQueryModule } from '../bookings/booking-query.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { AdminEventsController } from './admin-events.controller.js';
import { EventCancellationModule } from './event-cancellation.module.js';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';

@Module({
  imports: [BookingQueryModule, EventCancellationModule, InventoryModule],
  controllers: [EventsController, AdminEventsController],
  providers: [EventsService],
})
export class EventsModule {}
