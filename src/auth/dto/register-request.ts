import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
  Validate,
} from 'class-validator';

import { PasswordByteLengthConstraint } from '@/auth/password.js';

export class RegisterRequest {
  @ApiProperty({ format: 'email', example: 'ada@example.com', maxLength: 255 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({
    minLength: 12,
    maxLength: 72,
    description: 'At most 72 bytes. bcrypt ignores anything past that.',
    example: 'correct horse battery',
  })
  @IsString()
  @MinLength(12)
  @MaxLength(72)
  @Validate(PasswordByteLengthConstraint)
  password: string;
}
