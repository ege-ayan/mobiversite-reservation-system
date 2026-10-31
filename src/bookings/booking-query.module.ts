import { Module } from '@nestjs/common';

import { BookingQueryService } from './booking-query.service.js';

@Module({
  providers: [BookingQueryService],
  exports: [BookingQueryService],
})
export class BookingQueryModule {}
