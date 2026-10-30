import { applyDecorators } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const DEFAULT_PAGE_LIMIT = 20;

export class PageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export function ApiPageQueries() {
  return applyDecorators(
    ApiQuery({
      name: 'limit',
      required: false,
      description: 'Page size. Defaults to 20.',
      schema: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        default: DEFAULT_PAGE_LIMIT,
      },
    }),
    ApiQuery({
      name: 'cursor',
      required: false,
      description: 'nextCursor from the previous page',
      schema: { type: 'string' },
    }),
  );
}
