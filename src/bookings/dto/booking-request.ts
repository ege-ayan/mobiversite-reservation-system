import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsUUID,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

export function configuredTicketLimit(): number {
  const parsed = Number(process.env.MAX_ACTIVE_TICKETS_PER_EVENT);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return 10;
  }
  return parsed;
}

@ValidatorConstraint({ name: 'ticketQuantity', async: false })
export class TicketQuantityConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= configuredTicketLimit()
    );
  }

  defaultMessage(): string {
    return `quantity must not be greater than ${configuredTicketLimit()}`;
  }
}

export class BookingRequest {
  @ApiProperty({ example: '01932a5e-8c3a-7c2e-9b1a-6d4f2e8c0a11' })
  @IsUUID()
  eventId: string;

  @ApiProperty({
    example: 1,
    minimum: 1,
    maximum: 100,
    description:
      'At most MAX_ACTIVE_TICKETS_PER_EVENT tickets in one reservation. The default cap is 10.',
  })
  @IsInt()
  @Min(1)
  @Max(100)
  @Validate(TicketQuantityConstraint)
  quantity: number;
}
