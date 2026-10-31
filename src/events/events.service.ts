import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingsService } from '../bookings/bookings.service.js';
import { decodeCursor, slicePage } from '../common/pagination/cursor.js';
import { DEFAULT_PAGE_LIMIT } from '../common/pagination/page-query.js';
import { BookingStatus, Prisma } from '../generated/prisma/client.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { WRITE_TRANSACTION } from '../prisma/transaction.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { EventPage } from './dto/event-page.js';
import type { EventQuery } from './dto/event-query.js';
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
    private readonly inventory: InventoryService,
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

  async list(query: EventQuery): Promise<EventPage> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const events = await this.prisma.event.findMany({
      where: {
        deletedAt: null,
        ...this.catalogFilter(query),
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
    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await this.inventory.lockEvent(tx, id);
      if (!locked) {
        throw new NotFoundException('Event not found');
      }
      await this.inventory.releaseExpiredHolds(tx, id, new Date());
      const event = await tx.event.findUnique({ where: { id } });
      if (!event || event.deletedAt) {
        throw new NotFoundException('Event not found');
      }
      const reserved = event.totalTickets - event.availableTickets;
      if (request.totalTickets < reserved) {
        throw new ConflictException(
          'Ticket total is below existing reservations',
        );
      }
      return tx.event.update({
        where: { id },
        data: {
          ...this.toWriteData(request),
          availableTickets: {
            increment: request.totalTickets - event.totalTickets,
          },
        },
      });
    }, WRITE_TRANSACTION);
    return toEventResponse(updated);
  }

  async remove(id: string): Promise<void> {
    await this.requireVisibleEvent(id);
    await this.bookings.settleReservations(id);
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.inventory.lockEvent(tx, id);
      if (!locked) {
        throw new NotFoundException('Event not found');
      }
      const event = await tx.event.findUnique({ where: { id } });
      if (!event || event.deletedAt) {
        throw new NotFoundException('Event not found');
      }
      const open = await tx.booking.count({
        where: {
          eventId: id,
          status: { in: [BookingStatus.HELD, BookingStatus.PAID] },
        },
      });
      if (open > 0) {
        throw new ConflictException('Event still has open reservations');
      }
      await tx.event.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    }, WRITE_TRANSACTION);
  }

  private async requireVisibleEvent(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.inventory.lockEvent(tx, id);
      if (!locked) {
        throw new NotFoundException('Event not found');
      }
      const event = await tx.event.findUnique({ where: { id } });
      if (!event || event.deletedAt) {
        throw new NotFoundException('Event not found');
      }
    }, WRITE_TRANSACTION);
  }

  private catalogFilter(query: EventQuery): Prisma.EventWhereInput {
    const title = query.q?.trim();
    const from = query.from ? new Date(query.from) : new Date();
    if (query.to && from.getTime() > new Date(query.to).getTime()) {
      throw new BadRequestException('from must be before to');
    }
    return {
      salesClosedAt: null,
      ...(title ? { title: { contains: title } } : {}),
      startsAt: {
        gte: from,
        ...(query.to ? { lte: new Date(query.to) } : {}),
      },
    };
  }

  private async findEvent(id: string): Promise<EventResponseSource> {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event || event.deletedAt || event.salesClosedAt) {
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
