import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class PasswordTokenRequest {
  @ApiProperty({ enum: ['password'], example: 'password' })
  @IsIn(['password'])
  grant_type: 'password';

  @ApiProperty({
    description: 'Account email. OAuth 2.0 names this field username.',
    format: 'email',
    example: 'ada@example.com',
    maxLength: 255,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(255)
  username: string;

  @ApiProperty({ example: 'correct horse battery' })
  @IsString()
  password: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scope?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  client_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  client_secret?: string;
}

export class PasswordTokenResponse {
  @ApiProperty({
    description: 'Signed JWT access token',
  })
  access_token: string;

  @ApiProperty({ example: 'Bearer' })
  token_type: 'Bearer';

  @ApiProperty({
    description: 'Access token lifetime in seconds',
    example: 86400,
  })
  expires_in: number;

  @ApiProperty({
    description:
      'Opaque refresh token. Send it to /auth/refresh or /auth/logout.',
  })
  refresh_token: string;
}
