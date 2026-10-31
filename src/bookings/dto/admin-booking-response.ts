import { ApiProperty } from '@nestjs/swagger';

import { BookingResponse } from './booking-response.js';

export class AdminBookingResponse extends BookingResponse {
  @ApiProperty({ format: 'email', example: 'ada@example.com' })
  userEmail: string;
}
