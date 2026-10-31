import { Injectable } from '@nestjs/common';

import { notFound } from '@/common/errors/app.exception.js';
import { decodeCursor, slicePage } from '@/common/pagination/cursor.js';
import {
  DEFAULT_PAGE_LIMIT,
  type PageQuery,
} from '@/common/pagination/page-query.js';
import { PrismaService } from '@/prisma/prisma.service.js';

import {
  toAdminBookingResponse,
  toBookingResponse,
  type BookingWithEvent,
} from './booking-response.mapper.js';
import type { AdminBookingPage } from './dto/admin-booking-page.js';
import type { BookingPage } from './dto/booking-page.js';
import type { BookingResponse } from './dto/booking-response.js';

@Injectable()
export class BookingQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string, query: PageQuery): Promise<BookingPage> {
    const page = await this.pageBookings({ userId }, query);
    return {
      items: page.items.map((booking) => toBookingResponse(booking)),
      nextCursor: page.nextCursor,
    };
  }

  async listForEvent(
    eventId: string,
    query: PageQuery,
  ): Promise<AdminBookingPage> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) {
      throw notFound('Event not found', 'EVENT_NOT_FOUND');
    }
    const page = await this.pageBookings({ eventId }, query, true);
    return {
      items: page.items.map((booking) => toAdminBookingResponse(booking)),
      nextCursor: page.nextCursor,
    };
  }

  async findForUser(
    userId: string,
    bookingId: string,
  ): Promise<BookingResponse> {
    return toBookingResponse(await this.findOwned(userId, bookingId));
  }

  async findOwned(
    userId: string,
    bookingId: string,
  ): Promise<BookingWithEvent> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, userId },
      include: { event: true },
    });
    if (!booking) {
      throw notFound('Reservation not found', 'BOOKING_NOT_FOUND');
    }
    return booking;
  }

  private async pageBookings(
    where: { userId: string } | { eventId: string },
    query: PageQuery,
    withUser = false,
  ) {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const bookings = await this.prisma.booking.findMany({
      where: {
        ...where,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.at } },
                { createdAt: cursor.at, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: {
        event: true,
        ...(withUser ? { user: { select: { email: true } } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return slicePage(bookings, limit, (booking) => booking.createdAt);
  }
}
