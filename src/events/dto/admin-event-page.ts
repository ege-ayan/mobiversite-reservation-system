import { ApiProperty } from '@nestjs/swagger';
import { AdminEventResponse } from './admin-event-response.js';

export class AdminEventPage {
  @ApiProperty({ type: AdminEventResponse, isArray: true })
  items: AdminEventResponse[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor: string | null;
}
