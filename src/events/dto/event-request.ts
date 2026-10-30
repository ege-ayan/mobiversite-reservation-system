import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class EventRequest {
  @ApiProperty({ example: 'Mobiversite Live' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'An evening of talks and music.' })
  @IsString()
  @MaxLength(5000)
  description: string;

  @ApiProperty({ example: 'Kadikoy' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  venue: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-12-01T18:00:00.000Z',
  })
  @IsDateString()
  startsAt: string;

  @ApiProperty({ example: 25, minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  ticketPrice: number;

  @ApiProperty({ example: 100, minimum: 1 })
  @IsInt()
  @Min(1)
  totalTickets: number;
}
