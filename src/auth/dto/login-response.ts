import { ApiProperty } from '@nestjs/swagger';
import { UserResponse } from './user-response.js';

export class LoginResponse {
  @ApiProperty({
    description: 'Signed JWT access token',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMTkzMmE1ZSJ9.signature',
  })
  accessToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  @ApiProperty({
    description: 'Access token lifetime in seconds',
    example: 86400,
  })
  expiresIn: number;

  @ApiProperty({
    description:
      'Opaque refresh token. Send it to /auth/refresh or /auth/logout.',
  })
  refreshToken: string;

  @ApiProperty({
    description: 'Refresh token lifetime in seconds',
    example: 604800,
  })
  refreshExpiresIn: number;

  @ApiProperty({ type: UserResponse })
  user: UserResponse;
}
