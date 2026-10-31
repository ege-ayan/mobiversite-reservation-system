import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@/auth/decorators/public.decorator.js';

import { HealthResponse } from './dto/health-response.js';
import { HealthService } from './health.service.js';

@Public()
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Check that the API and database are reachable' })
  @ApiOkResponse({ type: HealthResponse })
  check(): Promise<HealthResponse> {
    return this.healthService.check();
  }
}
