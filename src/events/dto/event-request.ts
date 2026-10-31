import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
} from 'class-validator';

import { FutureDateConstraint } from './future-date.js';

class EventFields {
  @ApiProperty({ example: 'Mobiversite Live' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: 'An evening of talks and music.' })
  @IsString()
  @MaxLength(5000)
  description!: string;

  @ApiProperty({ example: 'Kadikoy' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  venue!: string;

  @ApiProperty({ example: 25, minimum: 0, maximum: 99_999_999.99 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  ticketPrice!: number;

  @ApiProperty({ example: 100, minimum: 1, maximum: 2_147_483_647 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  totalTickets!: number;
}

export class EventUpdateRequest extends EventFields {
  @ApiProperty({
    format: 'date-time',
    example: '2026-12-01T18:00:00.000Z',
  })
  @IsDateString()
  startsAt!: string;
}

export class EventRequest extends EventFields {
  @ApiProperty({
    format: 'date-time',
    example: '2026-12-01T18:00:00.000Z',
  })
  @IsDateString()
  @Validate(FutureDateConstraint)
  startsAt!: string;
}
