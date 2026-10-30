import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterRequest {
  @ApiProperty({ format: 'email', example: 'ada@example.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  email: string;

  @ApiProperty({
    minLength: 12,
    maxLength: 128,
    example: 'correct horse battery',
  })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password: string;
}
