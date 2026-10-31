import { ApiProperty } from '@nestjs/swagger';

export class EventCancellationResponse {
  @ApiProperty({ example: '01932a5e-8c3a-7c2e-9b1a-6d4f2e8c0a11' })
  id: string;

  @ApiProperty({ example: 'CANCELLING' })
  status: 'CANCELLING';
}
