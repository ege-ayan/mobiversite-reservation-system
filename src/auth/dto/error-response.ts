import { ApiProperty } from '@nestjs/swagger';

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
}

export class HttpErrorResponse {
  @ApiProperty({ example: 'Invalid email or password' })
  message: string;

  @ApiProperty({ example: 'Unauthorized' })
  error: string;

  @ApiProperty({ example: 401 })
  statusCode: number;
}
