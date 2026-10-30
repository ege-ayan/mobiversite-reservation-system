import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus } from '../../generated/prisma/client.js';
import { EventResponse } from '../../events/dto/event-response.js';

export class BookingResponse {
  @ApiProperty({ example: '01932a5e-8c3a-7c2e-9b1a-6d4f2e8c0a12' })
  id: string;

  @ApiProperty({ example: '01932a5e-8c3a-7c2e-9b1a-6d4f2e8c0a11' })
  eventId: string;

  @ApiProperty({ example: 1 })
  quantity: number;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.HELD })
  status: BookingStatus;

  @ApiProperty({ example: '25.00' })
  ticketPrice: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-10-30T18:30:00.000Z',
  })
  expiresAt: Date;

  @ApiProperty({ example: '2026-10-30T18:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ type: EventResponse })
  event: EventResponse;
}
