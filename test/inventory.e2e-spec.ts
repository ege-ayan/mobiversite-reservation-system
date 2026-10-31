import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';

import { BookingsService } from '@/bookings/bookings.service.js';
import { SWEEP_LOCK_NAME } from '@/common/locking/mysql-lock.js';
import { EventCancellationService } from '@/events/event-cancellation.service.js';
import { Role } from '@/generated/prisma/client.js';
import { PrismaService } from '@/prisma/prisma.service.js';

import {
  bearer,
  bootReservationApp,
  createEvent,
  eventBody,
  expire,
  loginAs,
  resetPayments,
  shutdownReservationApp,
  type PaymentDoubles,
} from './support/reservation-harness.js';

describe('Inventory (e2e)', () => {
  let app: INestApplication<App>;
  let payments: PaymentDoubles;

  beforeAll(async () => {
    ({ app, payments } = await bootReservationApp());
  });

  beforeEach(() => {
    resetPayments(payments);
  });

  afterAll(async () => {
    await shutdownReservationApp(app);
  });

  it('lets only one simultaneous reservation take the last ticket', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 1 }),
    );
    const customers = await Promise.all(
      Array.from({ length: 8 }, () => loginAs(app, Role.CUSTOMER)),
    );

    const attempts = await Promise.all(
      customers.map((customer) =>
        request(app.getHttpServer())
          .post('/api/v1/bookings')
          .set(bearer(customer.token))
          .send({ eventId: event.id, quantity: 1 }),
      ),
    );

    const created = attempts.filter((response) => response.status === 201);
    const conflicts = attempts.filter((response) => response.status === 409);
    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(attempts.length - 1);

    const stored = await app.get(PrismaService).event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(stored.availableTickets).toBe(0);
  });

  it('returns an unpaid hold to inventory after it expires', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 1 }),
    );
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);

    await app.get(PrismaService).booking.update({
      where: { id: reserved.body.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await expect(app.get(BookingsService).releaseExpiredHolds()).resolves.toBe(
      1,
    );

    const stored = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
      include: { event: true },
    });
    expect(stored.status).toBe('EXPIRED');
    expect(stored.event.availableTickets).toBe(1);

    await request(app.getHttpServer())
      .delete(`/api/v1/events/${event.id}`)
      .set(bearer(admin.token))
      .expect(202);
    await app.get(EventCancellationService).processOne(event.id);

    const afterDelete = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
      include: { event: true },
    });
    expect(afterDelete.status).toBe('EXPIRED');
    expect(afterDelete.event.availableTickets).toBe(1);
    expect(afterDelete.event.deletedAt).not.toBeNull();
    await request(app.getHttpServer())
      .get(`/api/v1/events/${event.id}`)
      .set(bearer(customer.token))
      .expect(404);
  });

  it('shows an expired hold before the sweep writes it', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 1 }),
    );
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    await expire(app, reserved.body.id);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/bookings')
      .set(bearer(customer.token))
      .expect(200);
    const catalog = await request(app.getHttpServer())
      .get(`/api/v1/events/${event.id}`)
      .set(bearer(customer.token))
      .expect(200);
    const stored = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
    });

    expect(listed.body.items[0].status).toBe('EXPIRED');
    expect(stored.status).toBe('HELD');
    expect(catalog.body.availableTickets).toBe(0);
  });

  it('lets the next reservation reclaim that event without the sweep', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const first = await loginAs(app, Role.CUSTOMER);
    const second = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 1 }),
    );
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(first.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    await expire(app, reserved.body.id);

    const taken = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(second.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);

    const prisma = app.get(PrismaService);
    const [oldHold, inventory] = await Promise.all([
      prisma.booking.findUniqueOrThrow({ where: { id: reserved.body.id } }),
      prisma.event.findUniqueOrThrow({ where: { id: event.id } }),
    ]);
    expect(oldHold.status).toBe('EXPIRED');
    expect(taken.body.status).toBe('HELD');
    expect(inventory.availableTickets).toBe(0);
  });

  it('keeps reclaimed tickets when the next request asks for more than remain', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 2 }),
    );
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    await expire(app, reserved.body.id);

    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 3 })
      .expect(409);

    const retry = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 2 })
      .expect(201);

    expect(retry.body.event.availableTickets).toBe(0);
    const oldHold = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
    });
    expect(oldHold.status).toBe('EXPIRED');
  });

  it('returns tickets once when payment or cancel arrives after expiry', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const payer = await loginAs(app, Role.CUSTOMER);
    const canceller = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 2 }),
    );
    const heldForPayment = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(payer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    const heldForCancel = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(canceller.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    await expire(app, heldForPayment.body.id);

    const unpaid = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${heldForPayment.body.id}/payment`)
      .set(bearer(payer.token))
      .expect(409);
    expect(unpaid.body.message).toBe('Reservation expired');
    expect(payments.confirm).not.toHaveBeenCalled();

    await expire(app, heldForCancel.body.id);
    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${heldForCancel.body.id}/cancel`)
      .set(bearer(canceller.token))
      .expect(409);
    expect(cancelled.body.message).toBe(
      'Reservation can no longer be cancelled',
    );

    await app.get(BookingsService).releaseExpiredHolds();
    const inventory = await app.get(PrismaService).event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(inventory.availableTickets).toBe(2);
  });

  it('returns every expired quantity for one event in a single sweep', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const first = await loginAs(app, Role.CUSTOMER);
    const second = await loginAs(app, Role.CUSTOMER);
    const untouched = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 4 }),
    );
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 3 }),
    );
    const held = await Promise.all(
      [first, second].map((customer) =>
        request(app.getHttpServer())
          .post('/api/v1/bookings')
          .set(bearer(customer.token))
          .send({
            eventId: event.id,
            quantity: customer === first ? 1 : 2,
          })
          .expect(201),
      ),
    );
    const other = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(first.token))
      .send({ eventId: untouched.id, quantity: 1 })
      .expect(201);
    await Promise.all(held.map((response) => expire(app, response.body.id)));

    await expect(app.get(BookingsService).releaseExpiredHolds()).resolves.toBe(
      2,
    );

    const prisma = app.get(PrismaService);
    const [inventory, otherInventory, otherHold] = await Promise.all([
      prisma.event.findUniqueOrThrow({ where: { id: event.id } }),
      prisma.event.findUniqueOrThrow({ where: { id: untouched.id } }),
      prisma.booking.findUniqueOrThrow({ where: { id: other.body.id } }),
    ]);
    expect(inventory.availableTickets).toBe(3);
    expect(otherInventory.availableTickets).toBe(3);
    expect(otherHold.status).toBe('HELD');
  });

  it('gives a reclaimed last ticket to only one of several simultaneous buyers', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const holder = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 1 }),
    );
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(holder.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    await expire(app, reserved.body.id);
    const buyers = await Promise.all(
      Array.from({ length: 8 }, () => loginAs(app, Role.CUSTOMER)),
    );

    const attempts = await Promise.all(
      buyers.map((buyer) =>
        request(app.getHttpServer())
          .post('/api/v1/bookings')
          .set(bearer(buyer.token))
          .send({ eventId: event.id, quantity: 1 }),
      ),
    );

    expect(attempts.filter((response) => response.status === 201)).toHaveLength(
      1,
    );
    expect(attempts.filter((response) => response.status === 409)).toHaveLength(
      7,
    );
    const prisma = app.get(PrismaService);
    const [inventory, holds] = await Promise.all([
      prisma.event.findUniqueOrThrow({ where: { id: event.id } }),
      prisma.booking.findMany({
        where: { eventId: event.id },
        select: { status: true },
      }),
    ]);
    expect(inventory.availableTickets).toBe(0);
    expect(holds.map((hold) => hold.status).sort()).toEqual([
      'EXPIRED',
      'HELD',
    ]);
  });

  it('takes and releases the sweep lock on one database session', async () => {
    const ids = await app.get(PrismaService).$transaction(async (tx) => {
      const [before] = await tx.$queryRaw<Array<{ id: number | bigint }>>`
        SELECT CONNECTION_ID() AS id
      `;
      await tx.$queryRaw`
        SELECT GET_LOCK(${SWEEP_LOCK_NAME}, 0)
      `;
      const [during] = await tx.$queryRaw<Array<{ id: number | bigint }>>`
        SELECT CONNECTION_ID() AS id
      `;
      await tx.$queryRaw`
        SELECT RELEASE_LOCK(${SWEEP_LOCK_NAME})
      `;
      return [before.id, during.id];
    });

    expect(String(ids[0])).toBe(String(ids[1]));
  });

  it('leaves expired holds untouched while another session owns the sweep lock', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 1 }),
    );
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    await expire(app, reserved.body.id);

    let releaseHold: () => void = () => undefined;
    const untilRelease = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    let markLocked: () => void = () => undefined;
    const untilLocked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const holder = app.get(PrismaService).$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT GET_LOCK(${SWEEP_LOCK_NAME}, 5)
        `;
        markLocked();
        await untilRelease;
        await tx.$queryRaw`
          SELECT RELEASE_LOCK(${SWEEP_LOCK_NAME})
        `;
      },
      { timeout: 20_000 },
    );

    await untilLocked;
    await expect(app.get(BookingsService).releaseExpiredHolds()).resolves.toBe(
      0,
    );
    const blocked = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
      include: { event: true },
    });
    expect(blocked.status).toBe('HELD');
    expect(blocked.event.availableTickets).toBe(0);

    releaseHold();
    await holder;
    await expect(app.get(BookingsService).releaseExpiredHolds()).resolves.toBe(
      1,
    );
    const released = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
      include: { event: true },
    });
    expect(released.status).toBe('EXPIRED');
    expect(released.event.availableTickets).toBe(1);
  });

  it('refuses payment when the sweep expires the hold while payment is in flight', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 1 }),
    );
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);

    payments.confirm.mockImplementation(async () => {
      await expire(app, reserved.body.id);
      await app.get(BookingsService).releaseExpiredHolds();
      return true;
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/payment`)
      .set(bearer(customer.token))
      .expect(409);

    expect(response.body.message).toBe('Reservation can no longer be paid');
    const stored = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
      include: { event: true },
    });
    expect(stored.status).toBe('EXPIRED');
    expect(stored.event.availableTickets).toBe(1);
  });

  it('lets payment and cancel race without returning a paid ticket', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 1 }),
    );
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);

    const [paid, cancelled] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/bookings/${reserved.body.id}/payment`)
        .set(bearer(customer.token)),
      request(app.getHttpServer())
        .post(`/api/v1/bookings/${reserved.body.id}/cancel`)
        .set(bearer(customer.token)),
    ]);

    expect([paid.status, cancelled.status].sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    const stored = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
      include: { event: true },
    });
    if (stored.status === 'PAID') {
      expect(stored.event.availableTickets).toBe(0);
    } else {
      expect(stored.status).toBe('CANCELLED');
      expect(stored.event.availableTickets).toBe(1);
    }
  });

  it('returns tickets once when two sweeps race', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 2 }),
    );
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 2 })
      .expect(201);
    await expire(app, reserved.body.id);

    const released = await Promise.all([
      app.get(BookingsService).releaseExpiredHolds(),
      app.get(BookingsService).releaseExpiredHolds(),
    ]);

    expect(released.reduce((sum, count) => sum + count, 0)).toBe(1);
    const stored = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
      include: { event: true },
    });
    expect(stored.status).toBe('EXPIRED');
    expect(stored.event.availableTickets).toBe(2);
  });

  it('rejects ticket counts the database cannot store', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 2 }),
    );
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    const prisma = app.get(PrismaService);

    await expect(
      prisma.$executeRaw`UPDATE events SET available_tickets = -1 WHERE id = ${event.id}`,
    ).rejects.toThrow(/check constraint/i);
    await expect(
      prisma.$executeRaw`UPDATE events SET available_tickets = total_tickets + 1 WHERE id = ${event.id}`,
    ).rejects.toThrow(/check constraint/i);
    await expect(
      prisma.$executeRaw`UPDATE bookings SET quantity = 0 WHERE id = ${reserved.body.id}`,
    ).rejects.toThrow(/check constraint/i);
  });
});
