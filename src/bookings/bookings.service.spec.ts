import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BookingStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BookingsService } from './bookings.service.js';
import { PaymentClient } from './payment.client.js';

const event = {
  id: 'event-id',
  title: 'Mobiversite Live',
  description: 'Talks',
  venue: 'Kadikoy',
  startsAt: new Date('2026-12-01T18:00:00.000Z'),
  ticketPrice: new Prisma.Decimal('25.00'),
  totalTickets: 3,
  availableTickets: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('BookingsService', () => {
  let service: BookingsService;
  let due: Array<{ id: string; quantity: number }>;
  const events = {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  };
  const bookings = {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  };
  const payments = { confirm: vi.fn() };
  const queryRaw = vi.fn();
  const tx = {
    event: events,
    booking: bookings,
    $queryRaw: queryRaw,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    due = [];
    events.findUnique.mockResolvedValue(event);
    events.findUniqueOrThrow.mockResolvedValue(event);
    events.updateMany.mockResolvedValue({ count: 1 });
    bookings.findMany.mockResolvedValue([]);
    bookings.updateMany.mockImplementation(async () => {
      const count = due.length;
      due = [];
      return { count };
    });
    queryRaw.mockImplementation(
      async (
        query: TemplateStringsArray | { strings: string[] },
        ...values: unknown[]
      ) => {
        const text = sqlText(query);
        if (text.includes('GET_LOCK')) {
          return [{ acquired: 1 }];
        }
        if (text.includes('RELEASE_LOCK')) {
          return [{ released: 1 }];
        }
        if (text.includes('DISTINCT')) {
          return [{ eventId: event.id }];
        }
        if (text.includes('FROM events')) {
          return [{ id: values[0] }];
        }
        if (text.includes('FROM bookings')) {
          return due.filter((row) => row.id !== 'other-event');
        }
        return [];
      },
    );

    const prisma = {
      event: events,
      booking: bookings,
      $queryRaw: queryRaw,
      $transaction: vi.fn(
        async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentClient, useValue: payments },
        { provide: ConfigService, useValue: { get: () => 1_800_000 } },
      ],
    }).compile();

    service = moduleRef.get(BookingsService);
  });

  it('returns reclaimed tickets before deciding a reservation does not fit', async () => {
    due = [{ id: 'old-hold', quantity: 1 }];
    events.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.reserve('user-id', { eventId: event.id, quantity: 2 }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(events.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: { availableTickets: { increment: 1 } },
    });
    expect(bookings.create).not.toHaveBeenCalled();
  });

  it('reclaims an expired hold and then takes the returned ticket', async () => {
    due = [{ id: 'old-hold', quantity: 1 }];
    bookings.create.mockResolvedValue({
      ...heldBooking(),
      event: { ...event, availableTickets: 0 },
    });

    const result = await service.reserve('user-id', {
      eventId: event.id,
      quantity: 1,
    });

    expect(bookings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['old-hold'] },
          status: BookingStatus.HELD,
        }),
        data: { status: BookingStatus.EXPIRED },
      }),
    );
    expect(events.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: { availableTickets: { increment: 1 } },
    });
    expect(result.status).toBe(BookingStatus.HELD);
  });

  it('rejects a reservation for an unknown event', async () => {
    queryRaw.mockImplementation(
      async (query: TemplateStringsArray | { strings: string[] }) => {
        const text = sqlText(query);
        if (text.includes('FROM events')) {
          return [];
        }
        return [];
      },
    );

    await expect(
      service.reserve('user-id', { eventId: 'missing', quantity: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns tickets when a held reservation is cancelled', async () => {
    const booking = { ...heldBooking(), event };
    bookings.findFirst.mockResolvedValue(booking);
    bookings.updateMany.mockResolvedValue({ count: 1 });
    bookings.findUniqueOrThrow.mockResolvedValue({
      ...booking,
      status: BookingStatus.CANCELLED,
    });

    const result = await service.cancel('user-id', booking.id);

    expect(events.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: { availableTickets: { increment: 1 } },
    });
    expect(result.status).toBe(BookingStatus.CANCELLED);
  });

  it('commits the inventory return when an expired hold can no longer be cancelled', async () => {
    const booking = {
      ...heldBooking(),
      expiresAt: new Date(Date.now() - 1_000),
      event,
    };
    due = [{ id: booking.id, quantity: 1 }];
    bookings.findFirst
      .mockResolvedValueOnce(booking)
      .mockResolvedValueOnce({ ...booking, status: BookingStatus.EXPIRED });

    await expect(service.cancel('user-id', booking.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(events.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: { availableTickets: { increment: 1 } },
    });
  });

  it('leaves the hold in place when payment is not confirmed', async () => {
    const booking = { ...heldBooking(), event };
    bookings.findFirst.mockResolvedValue(booking);
    payments.confirm.mockResolvedValue(false);

    await expect(service.pay('user-id', booking.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(payments.confirm).toHaveBeenCalledWith({
      bookingId: booking.id,
      amount: '25.00',
    });
    expect(bookings.updateMany).not.toHaveBeenCalled();
  });

  it('returns an expired hold before asking the payment service', async () => {
    const booking = {
      ...heldBooking(),
      expiresAt: new Date(Date.now() - 1_000),
      event,
    };
    due = [{ id: booking.id, quantity: booking.quantity }];
    bookings.findFirst
      .mockResolvedValueOnce(booking)
      .mockResolvedValueOnce({ ...booking, status: BookingStatus.EXPIRED });

    await expect(service.pay('user-id', booking.id)).rejects.toThrow(
      'Reservation expired',
    );
    expect(payments.confirm).not.toHaveBeenCalled();
    expect(events.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: { availableTickets: { increment: 1 } },
    });
  });

  it('cancels held and paid reservations for one event', async () => {
    bookings.findMany.mockResolvedValue([{ quantity: 2 }, { quantity: 1 }]);

    await expect(service.cancelOpenReservations(tx, event.id)).resolves.toBe(3);

    expect(bookings.updateMany).toHaveBeenCalledWith({
      where: {
        eventId: event.id,
        status: { in: [BookingStatus.HELD, BookingStatus.PAID] },
      },
      data: { status: BookingStatus.CANCELLED },
    });
  });

  it('shows a past hold as expired without writing', async () => {
    bookings.findMany.mockResolvedValue([
      {
        ...heldBooking(),
        expiresAt: new Date(Date.now() - 1_000),
        event,
      },
    ]);

    const listed = await service.listForUser('user-id', {});

    expect(listed.items[0]?.status).toBe(BookingStatus.EXPIRED);
    expect(listed.nextCursor).toBeNull();
    expect(bookings.updateMany).not.toHaveBeenCalled();
    expect(events.update).not.toHaveBeenCalled();
  });

  it('releases every expired hold of an event in one write', async () => {
    due = [
      { id: 'hold-a', quantity: 1 },
      { id: 'hold-b', quantity: 2 },
    ];

    await expect(service.releaseExpiredHolds()).resolves.toBe(2);
    expect(bookings.updateMany).toHaveBeenCalledTimes(1);
    expect(events.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: { availableTickets: { increment: 3 } },
    });
  });

  it('skips the sweep when another worker holds the lock', async () => {
    queryRaw.mockImplementation(
      async (query: TemplateStringsArray | { strings: string[] }) => {
        const text = sqlText(query);
        if (text.includes('GET_LOCK')) {
          return [{ acquired: 0 }];
        }
        if (text.includes('RELEASE_LOCK')) {
          return [{ released: 1 }];
        }
        return [];
      },
    );
    due = [{ id: 'hold-a', quantity: 1 }];

    await expect(service.releaseExpiredHolds()).resolves.toBe(0);
    expect(events.update).not.toHaveBeenCalled();
  });

  it('rejects a reservation for a hidden or started event', async () => {
    events.findUnique.mockResolvedValueOnce({
      ...event,
      deletedAt: new Date(),
    });
    await expect(
      service.reserve('user-id', { eventId: event.id, quantity: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);

    events.findUnique.mockResolvedValueOnce({
      ...event,
      startsAt: new Date(Date.now() - 1_000),
    });
    await expect(
      service.reserve('user-id', { eventId: event.id, quantity: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stops a reservation when the event is hidden after the lock', async () => {
    events.findUnique.mockResolvedValue(event);
    events.findUniqueOrThrow.mockResolvedValue({
      ...event,
      deletedAt: new Date(),
    });

    await expect(
      service.reserve('user-id', { eventId: event.id, quantity: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(bookings.create).not.toHaveBeenCalled();
  });

  it('rejects cancellation when the reservation disappears or loses the race', async () => {
    bookings.findFirst.mockResolvedValueOnce(null);
    await expect(service.cancel('user-id', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const booking = { ...heldBooking(), event };
    bookings.findFirst
      .mockResolvedValueOnce(booking)
      .mockResolvedValueOnce(null);
    await expect(service.cancel('user-id', booking.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    bookings.findFirst.mockResolvedValue(booking);
    bookings.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.cancel('user-id', booking.id)).rejects.toThrow(
      'Reservation can no longer be cancelled',
    );
  });

  it('returns a paid reservation without charging it again', async () => {
    bookings.findFirst.mockResolvedValue({
      ...heldBooking(),
      status: BookingStatus.PAID,
      event,
    });

    const result = await service.pay('user-id', 'booking-id');

    expect(result.status).toBe(BookingStatus.PAID);
    expect(payments.confirm).not.toHaveBeenCalled();
  });

  it('refuses payment for a cancelled or hidden reservation', async () => {
    bookings.findFirst.mockResolvedValueOnce({
      ...heldBooking(),
      status: BookingStatus.CANCELLED,
      event,
    });
    await expect(service.pay('user-id', 'booking-id')).rejects.toThrow(
      'Reservation can no longer be paid',
    );

    bookings.findFirst
      .mockResolvedValueOnce({ ...heldBooking(), event })
      .mockResolvedValueOnce({
        ...heldBooking(),
        event: { ...event, deletedAt: new Date() },
      });
    await expect(service.pay('user-id', 'booking-id')).rejects.toThrow(
      'Reservation can no longer be paid',
    );
    expect(payments.confirm).not.toHaveBeenCalled();
  });

  it('refuses payment when the event disappears while payment is confirmed', async () => {
    bookings.findFirst.mockResolvedValue({ ...heldBooking(), event });
    payments.confirm.mockResolvedValue(true);
    events.findUnique.mockResolvedValue({ ...event, deletedAt: new Date() });

    await expect(service.pay('user-id', 'booking-id')).rejects.toThrow(
      'Reservation can no longer be paid',
    );
  });

  it('refuses payment when the hold is no longer payable after confirmation', async () => {
    bookings.findFirst.mockResolvedValue({ ...heldBooking(), event });
    payments.confirm.mockResolvedValue(true);
    bookings.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.pay('user-id', 'booking-id')).rejects.toThrow(
      'Reservation can no longer be paid',
    );
  });

  it('refuses payment when the event lock is lost', async () => {
    let locks = 0;
    queryRaw.mockImplementation(
      async (
        query: TemplateStringsArray | { strings: string[] },
        ...values: unknown[]
      ) => {
        const text = sqlText(query);
        if (text.includes('FROM events')) {
          locks += 1;
          return locks < 2 ? [{ id: values[0] }] : [];
        }
        if (text.includes('FROM bookings')) {
          return [];
        }
        return [];
      },
    );
    bookings.findFirst.mockResolvedValue({ ...heldBooking(), event });
    payments.confirm.mockResolvedValue(true);

    await expect(service.pay('user-id', 'booking-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('pages a customer reservations with a cursor', async () => {
    const newer = {
      ...heldBooking(),
      id: '01932a5e-8c3a-7c2e-9b1a-6d4f2e8c0a12',
      createdAt: new Date('2026-03-02T00:00:00.000Z'),
      event,
    };
    const older = {
      ...heldBooking(),
      id: '01932a5e-8c3a-7c2e-9b1a-6d4f2e8c0a11',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      event,
    };
    bookings.findMany.mockResolvedValue([newer, older]);

    const page = await service.listForUser('user-id', { limit: 1 });

    expect(page.items.map((item) => item.id)).toEqual([newer.id]);
    expect(page.nextCursor).toEqual(expect.any(String));

    bookings.findMany.mockResolvedValue([older]);
    await service.listForUser('user-id', {
      limit: 1,
      cursor: page.nextCursor ?? undefined,
    });
    expect(bookings.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-id',
          OR: expect.any(Array),
        }),
      }),
    );
  });

  it('reads an event id using the driver column name', async () => {
    queryRaw.mockImplementation(
      async (query: TemplateStringsArray | { strings: string[] }) => {
        const text = sqlText(query);
        if (text.includes('GET_LOCK')) {
          return [{ acquired: 1 }];
        }
        if (text.includes('RELEASE_LOCK')) {
          return [{ released: 1 }];
        }
        if (text.includes('DISTINCT')) {
          return [{}, { eventid: event.id }];
        }
        if (text.includes('FROM events')) {
          return [{ id: event.id }];
        }
        if (text.includes('FROM bookings')) {
          return due;
        }
        return [];
      },
    );
    due = [{ id: 'hold-a', quantity: 1 }];

    await expect(service.releaseExpiredHolds()).resolves.toBe(1);
  });

  it('logs a release failure and continues with the next event', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    bookings.updateMany.mockResolvedValue({ count: 0 });
    due = [{ id: 'hold-a', quantity: 1 }];

    await expect(service.releaseExpiredHolds()).resolves.toBe(0);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

function heldBooking() {
  return {
    id: 'booking-id',
    userId: 'user-id',
    eventId: event.id,
    quantity: 1,
    status: BookingStatus.HELD,
    ticketPrice: new Prisma.Decimal('25.00'),
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function sqlText(query: TemplateStringsArray | { strings: string[] }) {
  if (Array.isArray(query)) {
    return query.join(' ');
  }
  return query.strings.join(' ');
}
