import { ApiProperty } from '@nestjs/swagger';

import { EventResponse } from './event-response.js';

export class EventPage {
  @ApiProperty({ type: EventResponse, isArray: true })
  items: EventResponse[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor: string | null;
}
