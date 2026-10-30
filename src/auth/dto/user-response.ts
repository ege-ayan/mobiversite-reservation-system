import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../generated/prisma/client.js';

export class UserResponse {
  @ApiProperty({ example: '01932a5e-8c3a-7c2e-9b1a-6d4f2e8c0a11' })
  id: string;

  @ApiProperty({ format: 'email', example: 'ada@example.com' })
  email: string;

  @ApiProperty({ enum: Role, example: Role.CUSTOMER })
  role: Role;

  @ApiProperty({ example: '2026-10-30T18:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-30T18:00:00.000Z' })
  updatedAt: Date;
}
