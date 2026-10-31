import { ApiProperty } from '@nestjs/swagger';

import { BookingResponse } from './booking-response.js';

export class BookingPage {
  @ApiProperty({ type: BookingResponse, isArray: true })
  items: BookingResponse[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor: string | null;
}
