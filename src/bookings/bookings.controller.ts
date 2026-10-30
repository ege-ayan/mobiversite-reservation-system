import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
import { ApiPageQueries, PageQuery } from '../pagination/page-query.js';
import { BookingsService } from './bookings.service.js';
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

  @Post()
  @ApiOperation({ summary: 'Reserve tickets for an event' })
  @ApiCreatedResponse({
    description: 'Tickets held until payment or the hold expires',
    type: BookingResponse,
  })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiConflictResponse({ description: 'Not enough tickets' })
  reserve(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: BookingRequest,
  ): Promise<BookingResponse> {
    return this.bookingsService.reserve(user.id, body);
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
