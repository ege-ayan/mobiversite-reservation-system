import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BookingStatus, Prisma } from '../generated/prisma/client.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { SweepLock } from '../common/locking/mysql-lock.js';
import { EventCancellationService } from '../events/event-cancellation.service.js';
import { PAYMENT_GATEWAY } from '../payment/payment.client.js';
import { ChargeService } from '../payment/charge.service.js';
import { RefundService } from '../payment/refund.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BookingQueryService } from './booking-query.service.js';
import { BookingsService } from './bookings.service.js';
import { ExpiryService } from './expiry.service.js';
import { requestFingerprint } from './idempotency-key.js';
import { ReservationService } from './reservation.service.js';

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
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    aggregate: vi.fn(),
  };
  const paymentAttempts = {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  };
  let transaction: ReturnType<typeof vi.fn>;
  const payments = {
    confirm: vi.fn(),
    refund: vi.fn(),
    lookup: vi.fn(),
  };
  const sweepLock = {
    tryWithLock: vi.fn(async (_name: string, work: () => Promise<unknown>) =>
      work(),
    ),
  };
  const queryRaw = vi.fn();
  const bookingEvents = {
    create: vi.fn().mockResolvedValue({}),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  const tx = {
    event: events,
    booking: bookings,
    paymentAttempt: paymentAttempts,
    bookingEvent: bookingEvents,
    $queryRaw: queryRaw,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    due = [];
    events.findUnique.mockResolvedValue(event);
    events.findUniqueOrThrow.mockResolvedValue(event);
    events.updateMany.mockResolvedValue({ count: 1 });
    bookings.findMany.mockResolvedValue([]);
    bookings.findUnique.mockReset();
    bookings.findUnique.mockResolvedValue(null);
    bookings.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    paymentAttempts.findFirst.mockResolvedValue(null);
    paymentAttempts.findMany.mockResolvedValue([]);
    paymentAttempts.count.mockResolvedValue(0);
    paymentAttempts.update.mockResolvedValue({});
    paymentAttempts.create.mockImplementation(async ({ data }) => ({
      id: 'attempt-id',
      state: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    }));
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

    transaction = vi.fn(async (run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
    );
    const prisma = {
      event: events,
      booking: bookings,
      paymentAttempt: paymentAttempts,
      bookingEvent: bookingEvents,
      $queryRaw: queryRaw,
      $transaction: transaction,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        ReservationService,
        BookingQueryService,
        ExpiryService,
        ChargeService,
        RefundService,
        EventCancellationService,
        InventoryService,
        { provide: PrismaService, useValue: prisma },
        { provide: PAYMENT_GATEWAY, useValue: payments },
        { provide: SweepLock, useValue: sweepLock },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'MAX_ACTIVE_TICKETS_PER_EVENT' ? 10 : 1_800_000,
          },
        },
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
    payments.refund.mockResolvedValue(true);

    await expect(service.pay('user-id', booking.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(payments.refund).not.toHaveBeenCalled();
    expect(payments.confirm).toHaveBeenCalledWith({
      bookingId: booking.id,
      amount: '25.00',
      idempotencyKey: booking.id,
      decision: undefined,
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

  it('refunds paid reservations and cancels holds when an event is removed', async () => {
    bookings.findMany
      .mockResolvedValueOnce([{ quantity: 1 }])
      .mockResolvedValueOnce([
        {
          id: 'paid-id',
          quantity: 2,
          ticketPrice: new Prisma.Decimal('25.00'),
        },
      ]);
    bookings.updateMany.mockResolvedValue({ count: 1 });
    payments.refund.mockResolvedValue(true);

    await service.settleReservations(event.id);

    expect(bookings.updateMany).toHaveBeenCalledWith({
      where: { eventId: event.id, status: BookingStatus.HELD },
      data: expect.objectContaining({ status: BookingStatus.CANCELLED }),
    });
    expect(payments.refund).toHaveBeenCalledWith({
      bookingId: 'paid-id',
      amount: '50.00',
      idempotencyKey: 'paid-id',
    });
    expect(bookings.updateMany).toHaveBeenCalledWith({
      where: { id: 'paid-id', status: BookingStatus.PAID },
      data: expect.objectContaining({ status: BookingStatus.REFUNDED }),
    });
    expect(events.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: { availableTickets: { increment: 2 } },
    });
  });

  it('refunds a paid reservation and returns its tickets', async () => {
    const booking = {
      ...heldBooking(),
      status: BookingStatus.PAID,
      quantity: 2,
      event,
    };
    bookings.findFirst.mockResolvedValue(booking);
    bookings.updateMany.mockResolvedValue({ count: 1 });
    bookings.findUniqueOrThrow.mockResolvedValue({
      ...booking,
      status: BookingStatus.REFUNDED,
    });
    payments.refund.mockResolvedValue(true);

    const result = await service.cancel('user-id', booking.id);

    expect(payments.refund).toHaveBeenCalledWith({
      bookingId: booking.id,
      amount: '50.00',
      idempotencyKey: booking.id,
    });
    expect(events.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: { availableTickets: { increment: 2 } },
    });
    expect(result.status).toBe(BookingStatus.REFUNDED);
  });

  it('keeps a paid reservation when the event has started', async () => {
    bookings.findFirst.mockResolvedValue({
      ...heldBooking(),
      status: BookingStatus.PAID,
      event: { ...event, startsAt: new Date(Date.now() - 1_000) },
    });

    await expect(service.cancel('user-id', 'booking-id')).rejects.toThrow(
      'Event has already started',
    );
    expect(payments.refund).not.toHaveBeenCalled();
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
    sweepLock.tryWithLock.mockResolvedValueOnce(null);
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

    bookings.findFirst.mockResolvedValueOnce({
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
    expect(payments.refund).toHaveBeenCalledWith({
      bookingId: 'booking-id',
      amount: '25.00',
      idempotencyKey: 'booking-id',
    });
  });

  it('refuses payment when the hold is no longer payable after confirmation', async () => {
    bookings.findFirst.mockResolvedValue({ ...heldBooking(), event });
    payments.confirm.mockResolvedValue(true);
    bookings.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.pay('user-id', 'booking-id')).rejects.toThrow(
      'Reservation can no longer be paid',
    );
    expect(payments.refund).toHaveBeenCalled();
  });

  it('refuses payment when the event lock is lost', async () => {
    queryRaw.mockImplementation(
      async (query: TemplateStringsArray | { strings: string[] }) => {
        const text = sqlText(query);
        if (text.includes('FROM events')) {
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
    expect(payments.refund).toHaveBeenCalled();
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

  it('returns the original reservation for the same idempotency key', async () => {
    const stored = {
      ...heldBooking(),
      event,
      idempotencyKey: 'same-key',
      requestHash: requestFingerprint(event.id, 1),
    };
    bookings.findUnique.mockResolvedValue(stored);

    const result = await service.reserve(
      'user-id',
      { eventId: event.id, quantity: 1 },
      'same-key',
    );

    expect(result.id).toBe(stored.id);
    expect(bookings.create).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key reused for a different quantity', async () => {
    bookings.findUnique.mockResolvedValue({
      ...heldBooking(),
      event,
      requestHash: requestFingerprint(event.id, 1),
    });

    await expect(
      service.reserve(
        'user-id',
        { eventId: event.id, quantity: 2 },
        'same-key',
      ),
    ).rejects.toThrow('Idempotency key was reused for a different request');
  });

  it('returns the winning reservation when the same key is inserted twice', async () => {
    const stored = {
      ...heldBooking(),
      event,
      idempotencyKey: 'same-key',
      requestHash: requestFingerprint(event.id, 1),
    };
    bookings.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(stored);
    transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '0.0.0',
      }),
    );

    const result = await service.reserve(
      'user-id',
      { eventId: event.id, quantity: 1 },
      'same-key',
    );

    expect(result.id).toBe(stored.id);
    expect(bookings.create).not.toHaveBeenCalled();
  });

  it('stores the idempotency key on a new hold', async () => {
    bookings.create.mockResolvedValue({ ...heldBooking(), event });

    await service.reserve(
      'user-id',
      { eventId: event.id, quantity: 1 },
      'same-key',
    );

    expect(bookings.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'same-key',
          requestHash: requestFingerprint(event.id, 1),
        }),
      }),
    );
  });

  it('rejects a reservation that would pass the per-customer ticket cap', async () => {
    bookings.aggregate.mockResolvedValue({ _sum: { quantity: 10 } });

    await expect(
      service.reserve('user-id', { eventId: event.id, quantity: 1 }),
    ).rejects.toThrow('You can reserve at most 10 tickets for an event');
    expect(bookings.create).not.toHaveBeenCalled();
  });

  it('applies a charge the provider already accepted', async () => {
    const booking = { ...heldBooking(), event };
    paymentAttempts.findMany.mockResolvedValue([
      {
        id: 'attempt-id',
        bookingId: booking.id,
        idempotencyKey: booking.id,
        state: 'PENDING',
        amount: new Prisma.Decimal('25.00'),
        updatedAt: new Date(Date.now() - 60_000),
        booking,
      },
    ]);
    payments.lookup.mockResolvedValue('paid');
    bookings.updateMany.mockResolvedValue({ count: 1 });
    bookings.findUniqueOrThrow.mockResolvedValue({
      ...booking,
      status: BookingStatus.PAID,
    });

    await expect(service.reconcilePayments()).resolves.toBe(1);
    expect(payments.lookup).toHaveBeenCalledWith(booking.id);
    expect(bookings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: BookingStatus.PAID }),
      }),
    );
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
