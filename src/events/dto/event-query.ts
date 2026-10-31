import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

import { PageQuery } from '@/common/pagination/page-query.js';

export class EventQuery extends PageQuery {
  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'Include events that start at or after this time. Defaults to the current time.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Include events that start at or before this time',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Case-insensitive match against the event title',
    example: 'live',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
