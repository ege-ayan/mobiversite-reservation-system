import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '../generated/prisma/client.js';
import { HttpErrorResponse } from '../common/dto/error-response.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ApiPageQueries, PageQuery } from '../pagination/page-query.js';
import { EventPage } from './dto/event-page.js';
import { EventRequest } from './dto/event-request.js';
import { EventResponse } from './dto/event-response.js';
import { EventsService } from './events.service.js';

@ApiTags('Events')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiPageQueries()
  @ApiOperation({ summary: 'List events and remaining tickets' })
  @ApiOkResponse({ type: EventPage })
  list(@Query() query: PageQuery): Promise<EventPage> {
    return this.eventsService.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one event' })
  @ApiOkResponse({ type: EventResponse })
  @ApiNotFoundResponse({ description: 'Event not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<EventResponse> {
    return this.eventsService.findOne(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create an event' })
  @ApiCreatedResponse({ type: EventResponse })
  @ApiForbiddenResponse({
    description: 'Insufficient role',
    type: HttpErrorResponse,
    example: {
      message: 'Insufficient role',
      error: 'Forbidden',
      statusCode: 403,
    },
  })
  create(@Body() body: EventRequest): Promise<EventResponse> {
    return this.eventsService.create(body);
  }

  @Put(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Replace every field of an event' })
  @ApiOkResponse({ type: EventResponse })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiConflictResponse({
    description: 'Ticket total is below existing reservations',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: EventRequest,
  ): Promise<EventResponse> {
    return this.eventsService.update(id, body);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Cancel held and paid reservations, then hide the event',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Event not found' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.eventsService.remove(id);
  }
}
