import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import { PageQuery } from '@/common/pagination/page-query.js';

export const ADMIN_EVENT_STATUSES = [
  'all',
  'on_sale',
  'upcoming',
  'past',
  'cancelling',
  'deleted',
] as const;

export type AdminEventStatus = (typeof ADMIN_EVENT_STATUSES)[number];

export class AdminEventQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ADMIN_EVENT_STATUSES, default: 'all' })
  @IsOptional()
  @IsIn([...ADMIN_EVENT_STATUSES])
  status?: AdminEventStatus;
}
