import { Injectable, Logger } from '@nestjs/common';

import {
  badRequest,
  conflict,
  notFound,
} from '@/common/errors/app.exception.js';
import { ErrorCode } from '@/common/errors/error-code.js';
import { decodeCursor, slicePage } from '@/common/pagination/cursor.js';
import { DEFAULT_PAGE_LIMIT } from '@/common/pagination/page-query.js';
import { Prisma } from '@/generated/prisma/client.js';
import { InventoryService } from '@/inventory/inventory.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { runWrite } from '@/prisma/retry.js';

import { catalogStatus } from './catalog-status.js';
import type { AdminEventPage } from './dto/admin-event-page.js';
import type { AdminEventQuery } from './dto/admin-event-query.js';
import type { AdminEventResponse } from './dto/admin-event-response.js';
import type { EventPage } from './dto/event-page.js';
import type { EventQuery } from './dto/event-query.js';
import type { EventRequest, EventUpdateRequest } from './dto/event-request.js';
import type { EventResponse } from './dto/event-response.js';
import { EventCancellationService } from './event-cancellation.service.js';
import {
  toEventResponse,
  type EventResponseSource,
} from './event-response.mapper.js';
import { titleFilter } from './title-filter.js';

type TicketStats = {
  heldTickets: number;
  paidTickets: number;
  paidRevenue: string;
};

const EMPTY_STATS: TicketStats = {
  heldTickets: 0,
  paidTickets: 0,
  paidRevenue: '0.00',
};

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cancellation: EventCancellationService,
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

  async listForAdmin(query: AdminEventQuery): Promise<AdminEventPage> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const events = await this.prisma.event.findMany({
      where: {
        ...this.adminFilter(query.status),
        ...(cursor
          ? {
              OR: [
                { startsAt: { lt: cursor.at } },
                { startsAt: cursor.at, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = slicePage(events, limit, (event) => event.startsAt);
    const stats = await this.ticketStats(page.items.map((event) => event.id));
    return {
      items: page.items.map((event) =>
        this.toAdminEvent(event, stats.get(event.id)),
      ),
      nextCursor: page.nextCursor,
    };
  }

  async findOne(id: string): Promise<EventResponse> {
    return toEventResponse(await this.findVisibleEvent(id));
  }

  async findForAdmin(id: string): Promise<AdminEventResponse> {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) {
      throw notFound('Event not found', ErrorCode.EVENT_NOT_FOUND);
    }
    const stats = await this.ticketStats([event.id]);
    return this.toAdminEvent(event, stats.get(event.id));
  }

  async update(
    id: string,
    request: EventUpdateRequest,
  ): Promise<EventResponse> {
    const updated = await runWrite(this.prisma, async (tx) => {
      const locked = await this.inventory.lockEvent(tx, id);
      if (!locked) {
        throw notFound('Event not found', ErrorCode.EVENT_NOT_FOUND);
      }
      await this.inventory.releaseExpiredHolds(tx, id, new Date());
      const event = await tx.event.findUnique({ where: { id } });
      if (!event || event.deletedAt) {
        throw notFound('Event not found', ErrorCode.EVENT_NOT_FOUND);
      }
      if (event.salesClosedAt) {
        throw conflict('Event is being cancelled', ErrorCode.EVENT_CANCELLING);
      }
      const reserved = event.totalTickets - event.availableTickets;
      if (request.totalTickets < reserved) {
        throw conflict(
          'Ticket total is below existing reservations',
          ErrorCode.CAPACITY_BELOW_RESERVED,
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
    });
    return toEventResponse(updated);
  }

  async remove(id: string) {
    const accepted = await this.cancellation.request(id);
    void Promise.resolve(this.cancellation.processOne(id)).catch(
      (error: unknown) => {
        this.logger.error(
          `Failed to cancel event ${id}`,
          error instanceof Error ? error.stack : undefined,
        );
      },
    );
    return accepted;
  }

  private catalogFilter(query: EventQuery): Prisma.EventWhereInput {
    const from = query.from ? new Date(query.from) : new Date();
    if (query.to && from.getTime() > new Date(query.to).getTime()) {
      throw badRequest('from must be before to', ErrorCode.INVALID_RANGE);
    }
    return {
      salesClosedAt: null,
      ...titleFilter(query.q),
      startsAt: {
        gte: from,
        ...(query.to ? { lte: new Date(query.to) } : {}),
      },
    };
  }

  private adminFilter(
    status: AdminEventQuery['status'],
  ): Prisma.EventWhereInput {
    const now = new Date();
    switch (status) {
      case 'on_sale':
      case 'upcoming':
        return {
          deletedAt: null,
          salesClosedAt: null,
          startsAt: { gt: now },
        };
      case 'past':
        return {
          deletedAt: null,
          salesClosedAt: null,
          startsAt: { lte: now },
        };
      case 'cancelling':
        return { deletedAt: null, salesClosedAt: { not: null } };
      case 'deleted':
        return { deletedAt: { not: null } };
      default:
        return {};
    }
  }

  private async findVisibleEvent(id: string): Promise<EventResponseSource> {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event || event.deletedAt || event.salesClosedAt) {
      throw notFound('Event not found', ErrorCode.EVENT_NOT_FOUND);
    }
    return event;
  }

  private toWriteData(request: EventUpdateRequest) {
    return {
      title: request.title.trim(),
      description: request.description.trim(),
      venue: request.venue.trim(),
      startsAt: new Date(request.startsAt),
      ticketPrice: new Prisma.Decimal(request.ticketPrice).toFixed(2),
      totalTickets: request.totalTickets,
    };
  }

  private toAdminEvent(
    event: EventResponseSource & {
      deletedAt: Date | null;
      salesClosedAt: Date | null;
    },
    stats: TicketStats | undefined,
  ): AdminEventResponse {
    const totals = stats ?? EMPTY_STATS;
    const response = toEventResponse(event);
    return {
      id: response.id,
      title: response.title,
      description: response.description,
      venue: response.venue,
      startsAt: response.startsAt,
      ticketPrice: response.ticketPrice,
      totalTickets: response.totalTickets,
      availableTickets: response.availableTickets,
      createdAt: response.createdAt,
      updatedAt: response.updatedAt,
      status: catalogStatus(event),
      deletedAt: event.deletedAt,
      salesClosedAt: event.salesClosedAt,
      heldTickets: totals.heldTickets,
      paidTickets: totals.paidTickets,
      paidRevenue: totals.paidRevenue,
    };
  }

  private async ticketStats(eventIds: string[]) {
    const stats = new Map<string, TicketStats>();
    if (eventIds.length === 0) {
      return stats;
    }
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(
      Prisma.sql`
        SELECT event_id AS eventId,
          COALESCE(SUM(CASE WHEN status = 'HELD' THEN quantity ELSE 0 END), 0) AS heldTickets,
          COALESCE(SUM(CASE WHEN status = 'PAID' THEN quantity ELSE 0 END), 0) AS paidTickets,
          COALESCE(SUM(CASE WHEN status = 'PAID' THEN ticket_price * quantity ELSE 0 END), 0) AS paidRevenue
        FROM bookings
        WHERE event_id IN (${Prisma.join(eventIds)})
        GROUP BY event_id
      `,
    );
    for (const row of rows) {
      const eventId = textColumn(row, 'eventId');
      if (!eventId) {
        continue;
      }
      stats.set(eventId, {
        heldTickets: readCount(column(row, 'heldTickets')),
        paidTickets: readCount(column(row, 'paidTickets')),
        paidRevenue: new Prisma.Decimal(
          readCount(column(row, 'paidRevenue')),
        ).toFixed(2),
      });
    }
    return stats;
  }
}

function column(row: Record<string, unknown>, name: string) {
  if (name in row) {
    return row[name];
  }
  const match = Object.entries(row).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return match?.[1];
}

function textColumn(row: Record<string, unknown>, name: string) {
  const value = column(row, name);
  return typeof value === 'string' ? value : undefined;
}

function readCount(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
