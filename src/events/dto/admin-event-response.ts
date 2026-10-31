import { ApiProperty } from '@nestjs/swagger';
import { CATALOG_STATUSES, type CatalogStatus } from '../catalog-status.js';
import { EventResponse } from './event-response.js';

export class AdminEventResponse extends EventResponse {
  @ApiProperty({ enum: CATALOG_STATUSES, example: 'ON_SALE' })
  status: CatalogStatus;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  salesClosedAt: Date | null;

  @ApiProperty({ example: 0 })
  heldTickets: number;

  @ApiProperty({ example: 2 })
  paidTickets: number;

  @ApiProperty({ example: '50.00' })
  paidRevenue: string;
}
