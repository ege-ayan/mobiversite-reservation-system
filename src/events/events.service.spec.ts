import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BookingsService } from '../bookings/bookings.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsService } from './events.service.js';

const request = {
  title: ' Mobiversite Live ',
  description: ' Talks ',
  venue: ' Kadikoy ',
  startsAt: '2026-12-01T18:00:00.000Z',
  ticketPrice: 25,
  totalTickets: 10,
};

describe('EventsService', () => {
  let service: EventsService;
  const events = {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const reservations = { settleReservations: vi.fn() };
  const transaction = vi.fn();

  beforeEach(async () => {
    events.create.mockReset();
    events.findUnique.mockReset();
    events.update.mockReset();
    events.delete.mockReset();
    reservations.settleReservations.mockReset();
    transaction.mockReset();

    const moduleRef = await Test.createTestingModule({
      providers: [
        EventsService,
        {
          provide: PrismaService,
          useValue: { event: events, $transaction: transaction },
        },
        { provide: BookingsService, useValue: reservations },
        InventoryService,
      ],
    }).compile();

    service = moduleRef.get(EventsService);
  });

  it('creates an event with the full inventory available', async () => {
    events.create.mockImplementation(async ({ data }) => ({
      id: 'event-id',
      ...data,
      ticketPrice: new Prisma.Decimal(data.ticketPrice),
      startsAt: new Date(data.startsAt),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }));

    const result = await service.create(request);

    expect(events.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Mobiversite Live',
        description: 'Talks',
        venue: 'Kadikoy',
        totalTickets: 10,
        availableTickets: 10,
      }),
    });
    expect(result.availableTickets).toBe(10);
    expect(result.ticketPrice).toBe('25.00');
  });

  it('rejects a ticket total below the reservations already held', async () => {
    const tx = lockedEventTx(
      storedEvent({ totalTickets: 10, availableTickets: 4 }),
    );
    transaction.mockImplementation(
      async (run: (client: typeof tx) => unknown) => run(tx),
    );

    await expect(
      service.update('event-id', { ...request, totalTickets: 5 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.event.update).not.toHaveBeenCalled();
  });

  it('settles reservations and then hides the event', async () => {
    const tx = lockedEventTx(storedEvent());
    transaction.mockImplementation(
      async (run: (client: typeof tx) => unknown) => run(tx),
    );

    await service.remove('event-id');

    expect(reservations.settleReservations).toHaveBeenCalledWith('event-id');
    expect(tx.event.update).toHaveBeenCalledWith({
      where: { id: 'event-id' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(events.delete).not.toHaveBeenCalled();
  });

  it('rejects deleting an event that is already hidden', async () => {
    const tx = lockedEventTx(storedEvent({ deletedAt: new Date() }));
    transaction.mockImplementation(
      async (run: (client: typeof tx) => unknown) => run(tx),
    );

    await expect(service.remove('event-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(reservations.settleReservations).not.toHaveBeenCalled();
    expect(tx.event.update).not.toHaveBeenCalled();
  });

  it('returns one visible event', async () => {
    events.findUnique.mockResolvedValue(storedEvent());

    const result = await service.findOne('event-id');

    expect(result.id).toBe('event-id');
    expect(result.ticketPrice).toBe('25.00');
  });

  it('hides a missing or deleted event', async () => {
    events.findUnique.mockResolvedValueOnce(null);
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    events.findUnique.mockResolvedValueOnce(
      storedEvent({ deletedAt: new Date() }),
    );
    await expect(service.findOne('event-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('replaces an event under a row lock and keeps the reserved ticket count', async () => {
    const current = storedEvent({ totalTickets: 10, availableTickets: 4 });
    const tx = lockedEventTx(current);
    tx.event.update.mockImplementation(async ({ data }) => ({
      ...current,
      title: data.title,
      description: data.description,
      venue: data.venue,
      ticketPrice: new Prisma.Decimal(data.ticketPrice),
      startsAt: new Date(data.startsAt),
      totalTickets: data.totalTickets,
    }));
    transaction.mockImplementation(
      async (run: (client: typeof tx) => unknown) => run(tx),
    );

    const result = await service.update('event-id', request);

    expect(tx.event.update).toHaveBeenCalledWith({
      where: { id: 'event-id' },
      data: expect.objectContaining({
        totalTickets: 10,
        availableTickets: { increment: 0 },
      }),
    });
    expect(result.availableTickets).toBe(4);
  });

  it('pages the catalog from a cursor', async () => {
    const first = storedEvent({
      id: '01932a5e-8c3a-7c2e-9b1a-6d4f2e8c0a11',
    });
    const second = storedEvent({
      id: '01932a5e-8c3a-7c2e-9b1a-6d4f2e8c0a12',
      startsAt: new Date('2026-12-02T18:00:00.000Z'),
    });
    events.findMany.mockResolvedValue([first, second]);

    const page = await service.list({ limit: 1 });

    expect(page.items.map((item) => item.id)).toEqual([first.id]);
    expect(page.nextCursor).toEqual(expect.any(String));

    events.findMany.mockResolvedValue([second]);
    await service.list({ limit: 1, cursor: page.nextCursor ?? undefined });
    expect(events.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          OR: expect.any(Array),
        }),
      }),
    );
  });

  it('rejects deleting an event that is not locked', async () => {
    transaction.mockImplementation(
      async (
        run: (client: { $queryRaw: () => Promise<unknown[]> }) => unknown,
      ) => run({ $queryRaw: vi.fn().mockResolvedValue([]) }),
    );

    await expect(service.remove('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(reservations.settleReservations).not.toHaveBeenCalled();
  });

  it('filters the catalog by title and start time', async () => {
    events.findMany.mockResolvedValue([]);

    await service.list({
      q: ' live ',
      from: '2026-12-01T00:00:00.000Z',
      to: '2026-12-31T00:00:00.000Z',
    });

    expect(events.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          title: { contains: 'live' },
          startsAt: {
            gte: new Date('2026-12-01T00:00:00.000Z'),
            lte: new Date('2026-12-31T00:00:00.000Z'),
          },
        },
      }),
    );

    await expect(
      service.list({
        from: '2026-12-31T00:00:00.000Z',
        to: '2026-12-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function lockedEventTx(event: ReturnType<typeof storedEvent>) {
  return {
    $queryRaw: vi
      .fn()
      .mockImplementation(
        (query: TemplateStringsArray | { strings: string[] }) => {
          const text = Array.isArray(query)
            ? query.join(' ')
            : query.strings.join(' ');
          if (text.includes('FROM events')) {
            return [{ id: event.id }];
          }
          return [];
        },
      ),
    event: {
      findUnique: vi.fn().mockResolvedValue(event),
      update: vi.fn(),
    },
    booking: {
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

function storedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-id',
    title: 'Mobiversite Live',
    description: 'Talks',
    venue: 'Kadikoy',
    startsAt: new Date('2026-12-01T18:00:00.000Z'),
    ticketPrice: new Prisma.Decimal('25.00'),
    totalTickets: 10,
    availableTickets: 10,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}
