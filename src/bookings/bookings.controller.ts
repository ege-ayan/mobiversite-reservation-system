import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { HttpErrorResponse } from '../common/dto/error-response.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/client.js';
import { ApiPageQueries, PageQuery } from '../common/pagination/page-query.js';
import { BookingsService } from './bookings.service.js';
import { parseIdempotencyKey } from './idempotency-key.js';
import { BookingPage } from './dto/booking-page.js';
import { BookingRequest } from './dto/booking-request.js';
import { BookingResponse } from './dto/booking-response.js';

const forbidden = {
  description: 'Insufficient role',
  type: HttpErrorResponse,
  example: {
    message: 'Insufficient role',
    error: 'Forbidden',
    statusCode: 403,
  },
};

@ApiTags('Bookings')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiForbiddenResponse(forbidden)
@Roles(Role.CUSTOMER)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  @ApiPageQueries()
  @ApiOperation({ summary: 'List the current customer reservations' })
  @ApiOkResponse({ type: BookingPage })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PageQuery,
  ): Promise<BookingPage> {
    return this.bookingsService.listForUser(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one reservation for the current customer' })
  @ApiOkResponse({ type: BookingResponse })
  @ApiNotFoundResponse({ description: 'Reservation not found' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BookingResponse> {
    return this.bookingsService.findForUser(user.id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Reserve tickets for an event' })
  @ApiCreatedResponse({
    description: 'Tickets held until payment or the hold expires',
    type: BookingResponse,
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'When the same customer sends this key again, the original reservation is returned. A different body with the same key is rejected.',
    example: '8f14e45f-ceea-467a-9c0a-7a5c2c4d1e10',
  })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiBadRequestResponse({ description: 'Invalid idempotency key' })
  @ApiConflictResponse({
    description:
      'Not enough tickets, or the idempotency key was reused for a different request',
  })
  reserve(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: BookingRequest,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ): Promise<BookingResponse> {
    return this.bookingsService.reserve(
      user.id,
      body,
      parseIdempotencyKey(idempotencyKey),
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a reservation and return its tickets' })
  @ApiOkResponse({ type: BookingResponse })
  @ApiNotFoundResponse({ description: 'Reservation not found' })
  @ApiConflictResponse({
    description: 'Reservation can no longer be cancelled',
  })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BookingResponse> {
    return this.bookingsService.cancel(user.id, id);
  }

  @Post(':id/payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm payment for a held reservation with the payment service',
  })
  @ApiOkResponse({ type: BookingResponse })
  @ApiNotFoundResponse({ description: 'Reservation not found' })
  @ApiConflictResponse({ description: 'Payment was not confirmed' })
  pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BookingResponse> {
    return this.bookingsService.pay(user.id, id);
  }
}
