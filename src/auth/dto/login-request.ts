import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString } from 'class-validator';

export class LoginRequest {
  @ApiProperty({ format: 'email', example: 'ada@example.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'correct horse battery' })
  @IsString()
  password: string;
}
