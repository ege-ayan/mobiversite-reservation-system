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
  ApiQuery,
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
import { ApiPageQueries, PageQuery } from '../common/pagination/page-query.js';
import { BookingsService } from '../bookings/bookings.service.js';
import { AdminBookingPage } from '../bookings/dto/admin-booking-page.js';
import { EventPage } from './dto/event-page.js';
import { EventQuery } from './dto/event-query.js';
import { EventRequest } from './dto/event-request.js';
import { EventResponse } from './dto/event-response.js';
import { EventsService } from './events.service.js';

@ApiTags('Events')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('events')
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly bookingsService: BookingsService,
  ) {}

  @Get()
  @ApiPageQueries()
  @ApiQuery({
    name: 'from',
    required: false,
    description:
      'Include events that start at or after this time. Defaults to now.',
    schema: { type: 'string', format: 'date-time' },
  })
  @ApiQuery({
    name: 'to',
    required: false,
    schema: { type: 'string', format: 'date-time' },
  })
  @ApiQuery({ name: 'q', required: false, schema: { type: 'string' } })
  @ApiOperation({ summary: 'List events and remaining tickets' })
  @ApiOkResponse({ type: EventPage })
  list(@Query() query: EventQuery): Promise<EventPage> {
    return this.eventsService.list(query);
  }

  @Get(':id/bookings')
  @Roles(Role.ADMIN)
  @ApiPageQueries()
  @ApiOperation({ summary: 'List reservations for an event' })
  @ApiOkResponse({ type: AdminBookingPage })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiForbiddenResponse({
    description: 'Insufficient role',
    type: HttpErrorResponse,
  })
  listBookings(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PageQuery,
  ): Promise<AdminBookingPage> {
    return this.bookingsService.listForEvent(id, query);
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
    summary: 'Refund paid reservations, cancel holds, then hide the event',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Event not found' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.eventsService.remove(id);
  }
}
