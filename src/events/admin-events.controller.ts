import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { HttpErrorResponse } from '../common/dto/error-response.js';
import { ApiPageQueries } from '../common/pagination/page-query.js';
import { Role } from '../generated/prisma/client.js';
import { AdminEventPage } from './dto/admin-event-page.js';
import { AdminEventQuery } from './dto/admin-event-query.js';
import { AdminEventResponse } from './dto/admin-event-response.js';
import { EventsService } from './events.service.js';

@ApiTags('Events')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiForbiddenResponse({
  description: 'Insufficient role',
  type: HttpErrorResponse,
})
@Roles(Role.ADMIN)
@Controller('admin/events')
export class AdminEventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiPageQueries()
  @ApiOperation({
    summary: 'List every event, including hidden and finished ones',
  })
  @ApiOkResponse({ type: AdminEventPage })
  list(@Query() query: AdminEventQuery): Promise<AdminEventPage> {
    return this.eventsService.listForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one event, including one that is hidden' })
  @ApiOkResponse({ type: AdminEventResponse })
  @ApiNotFoundResponse({ description: 'Event not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AdminEventResponse> {
    return this.eventsService.findForAdmin(id);
  }
}
