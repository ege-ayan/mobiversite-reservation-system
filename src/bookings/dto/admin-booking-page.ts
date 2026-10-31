import { ApiProperty } from '@nestjs/swagger';
import { AdminBookingResponse } from './admin-booking-response.js';

export class AdminBookingPage {
  @ApiProperty({ type: AdminBookingResponse, isArray: true })
  items: AdminBookingResponse[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor: string | null;
}
