import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshRequest {
  @ApiProperty({
    description: 'Refresh token returned by login or refresh',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  refreshToken: string;
}
