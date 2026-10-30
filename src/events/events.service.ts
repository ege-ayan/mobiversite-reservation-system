import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingsService } from '../bookings/bookings.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { decodeCursor, slicePage } from '../pagination/cursor.js';
import {
  DEFAULT_PAGE_LIMIT,
  type PageQuery,
} from '../pagination/page-query.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { EventPage } from './dto/event-page.js';
import type { EventRequest } from './dto/event-request.js';
import type { EventResponse } from './dto/event-response.js';
import {
  toEventResponse,
  type EventResponseSource,
} from './event-response.mapper.js';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
  ) {}

  async create(request: EventRequest): Promise<EventResponse> {
    const event = await this.prisma.event.create({
      data: {
        ...this.toWriteData(request),
        availableTickets: request.totalTickets,
      },
    });
    return toEventResponse(event);
  }

  async list(query: PageQuery): Promise<EventPage> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const events = await this.prisma.event.findMany({
      where: {
        deletedAt: null,
        ...(cursor
          ? {
              OR: [
                { startsAt: { gt: cursor.at } },
                { startsAt: cursor.at, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = slicePage(events, limit, (event) => event.startsAt);
    return {
      items: page.items.map(toEventResponse),
      nextCursor: page.nextCursor,
    };
  }

  async findOne(id: string): Promise<EventResponse> {
    const event = await this.findEvent(id);
    return toEventResponse(event);
  }

  async update(id: string, request: EventRequest): Promise<EventResponse> {
    const event = await this.findEvent(id);
    const reserved = event.totalTickets - event.availableTickets;
    if (request.totalTickets < reserved) {
      throw new ConflictException(
        'Ticket total is below existing reservations',
      );
    }

    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        ...this.toWriteData(request),
        availableTickets: request.totalTickets - reserved,
      },
    });
    return toEventResponse(updated);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM events WHERE id = ${id} FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException('Event not found');
      }

      const event = await tx.event.findUnique({ where: { id } });
      if (!event || event.deletedAt) {
        throw new NotFoundException('Event not found');
      }

      const returned = await this.bookings.cancelOpenReservations(tx, id);
      await tx.event.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          ...(returned > 0
            ? { availableTickets: { increment: returned } }
            : {}),
        },
      });
    });
  }

  private async findEvent(id: string): Promise<EventResponseSource> {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event || event.deletedAt) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  private toWriteData(request: EventRequest) {
    return {
      title: request.title.trim(),
      description: request.description.trim(),
      venue: request.venue.trim(),
      startsAt: new Date(request.startsAt),
      ticketPrice: new Prisma.Decimal(request.ticketPrice).toFixed(2),
      totalTickets: request.totalTickets,
    };
  }
}
