import { ApiProperty } from '@nestjs/swagger';

export class EventResponse {
  @ApiProperty({ example: '01932a5e-8c3a-7c2e-9b1a-6d4f2e8c0a11' })
  id: string;

  @ApiProperty({ example: 'Mobiversite Live' })
  title: string;

  @ApiProperty({ example: 'An evening of talks and music.' })
  description: string;

  @ApiProperty({ example: 'Kadikoy' })
  venue: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-12-01T18:00:00.000Z',
  })
  startsAt: Date;

  @ApiProperty({ example: '25.00' })
  ticketPrice: string;

  @ApiProperty({ example: 100 })
  totalTickets: number;

  @ApiProperty({ example: 100 })
  availableTickets: number;

  @ApiProperty({ example: '2026-10-30T18:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-30T18:00:00.000Z' })
  updatedAt: Date;
}
