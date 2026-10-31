import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ValidationErrorResponse {
  @ApiProperty({
    type: [String],
    example: ['email must be an email'],
  })
  message: string[];

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiPropertyOptional({ example: 'VALIDATION_ERROR' })
  code?: string;
}

export class HttpErrorResponse {
  @ApiProperty({ example: 'Invalid email or password' })
  message: string;

  @ApiProperty({ example: 'Unauthorized' })
  error: string;

  @ApiProperty({ example: 401 })
  statusCode: number;

  @ApiPropertyOptional({ example: 'INVALID_CREDENTIALS' })
  code?: string;
}
