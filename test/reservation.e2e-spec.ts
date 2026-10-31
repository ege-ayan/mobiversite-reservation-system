import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { PAYMENT_GATEWAY } from '../src/payment/payment.client.js';
import { SWEEP_LOCK_NAME } from '../src/bookings/sweep-lock.js';
import { configureApp } from '../src/config/app.config.js';
import { Role } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Reservations (e2e)', () => {
  let app: INestApplication<App>;
  const payments = { confirm: vi.fn(), refund: vi.fn() };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(payments)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    payments.confirm.mockReset();
    payments.confirm.mockResolvedValue(true);
    payments.refund.mockReset();
    payments.refund.mockResolvedValue(true);
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.paymentAttempt.deleteMany({
      where: { booking: { event: { title: { startsWith: 'test-event-' } } } },
    });
    await prisma.booking.deleteMany({
      where: { event: { title: { startsWith: 'test-event-' } } },
    });
    await prisma.event.deleteMany({
      where: { title: { startsWith: 'test-event-' } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: '@example.test' } },
    });
    await app.close();
  });

  it('lets an admin manage events and a customer read them', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const body = eventBody();

    await request(app.getHttpServer()).post('/events').send(body).expect(401);

    await request(app.getHttpServer())
      .post('/events')
      .set(bearer(customer.token))
      .send(body)
      .expect(403);

    const created = await request(app.getHttpServer())
      .post('/events')
      .set(bearer(admin.token))
      .send(body)
      .expect(201);

    expect(created.body.availableTickets).toBe(body.totalTickets);
    expect(created.body.ticketPrice).toBe('25.00');

    const replacement = eventBody({
      title: created.body.title,
      venue: 'Besiktas',
      totalTickets: 8,
    });
    const updated = await request(app.getHttpServer())
      .put(`/events/${created.body.id}`)
      .set(bearer(admin.token))
      .send(replacement)
      .expect(200);

    expect(updated.body.venue).toBe('Besiktas');
    expect(updated.body.totalTickets).toBe(8);

    const listed = await request(app.getHttpServer())
      .get('/events')
      .set(bearer(customer.token))
      .expect(200);

    expect(listed.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.body.id, venue: 'Besiktas' }),
      ]),
    );

    await request(app.getHttpServer())
      .delete(`/events/${created.body.id}`)
      .set(bearer(customer.token))
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/events/${created.body.id}`)
      .set(bearer(admin.token))
      .expect(204);

    await request(app.getHttpServer())
      .get(`/events/${created.body.id}`)
      .set(bearer(customer.token))
      .expect(404);
  });

  it('holds tickets, confirms payment, and returns them on cancel', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 2 }),
    );

    await request(app.getHttpServer())
      .post('/bookings')
      .set(bearer(admin.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(403);

    const reserved = await request(app.getHttpServer())
      .post('/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);

    expect(reserved.body.status).toBe('HELD');
    expect(reserved.body.event.availableTickets).toBe(1);

    const mine = await request(app.getHttpServer())
      .get('/bookings')
      .set(bearer(customer.token))
      .expect(200);
    expect(mine.body.items).toHaveLength(1);

    const paid = await request(app.getHttpServer())
      .post(`/bookings/${reserved.body.id}/payment`)
      .set(bearer(customer.token))
      .expect(200);

    expect(paid.body.status).toBe('PAID');
    expect(payments.confirm).toHaveBeenCalledWith({
      bookingId: reserved.body.id,
      amount: '25.00',
      idempotencyKey: reserved.body.id,
      decline: undefined,
    });

    const cancelled = await request(app.getHttpServer())
      .post(`/bookings/${reserved.body.id}/cancel`)
      .set(bearer(customer.token))
      .expect(200);

    expect(cancelled.body.status).toBe('REFUNDED');
    expect(cancelled.body.event.availableTickets).toBe(2);

    const one = await request(app.getHttpServer())
      .get(`/bookings/${reserved.body.id}`)
      .set(bearer(customer.token))
      .expect(200);
    expect(one.body.status).toBe('REFUNDED');

    const forAdmin = await request(app.getHttpServer())
      .get(`/events/${event.id}/bookings`)
      .set(bearer(admin.token))
      .expect(200);
    expect(forAdmin.body.items).toEqual([
      expect.objectContaining({
        id: reserved.body.id,
        userEmail: customer.email,
      }),
    ]);
    await request(app.getHttpServer())
      .get(`/events/${event.id}/bookings`)
      .set(bearer(customer.token))
      .expect(403);

    await request(app.getHttpServer())
      .post(`/bookings/${reserved.body.id}/cancel`)
      .set(bearer(admin.token))
      .expect(403);
  });

  it('keeps the hold when the payment service declines it', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 1 }),
    );
    const reserved = await request(app.getHttpServer())
      .post('/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);

    payments.confirm.mockResolvedValue(false);
    const declined = await request(app.getHttpServer())
      .post(`/bookings/${reserved.body.id}/payment`)
      .set(bearer(customer.token))
      .expect(409);

    expect(declined.body.message).toBe('Payment was not confirmed');

    const stored = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
    });
    expect(stored.status).toBe('HELD');
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
          .post('/bookings')
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
      .post('/bookings')
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
      .delete(`/events/${event.id}`)
      .set(bearer(admin.token))
      .expect(204);

    const afterDelete = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
      include: { event: true },
    });
    expect(afterDelete.status).toBe('EXPIRED');
    expect(afterDelete.event.availableTickets).toBe(1);
    expect(afterDelete.event.deletedAt).not.toBeNull();
    await request(app.getHttpServer())
      .get(`/events/${event.id}`)
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
      .post('/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    await expire(app, reserved.body.id);

    const listed = await request(app.getHttpServer())
      .get('/bookings')
      .set(bearer(customer.token))
      .expect(200);
    const catalog = await request(app.getHttpServer())
      .get(`/events/${event.id}`)
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
      .post('/bookings')
      .set(bearer(first.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    await expire(app, reserved.body.id);

    const taken = await request(app.getHttpServer())
      .post('/bookings')
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
      .post('/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    await expire(app, reserved.body.id);

    await request(app.getHttpServer())
      .post('/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 3 })
      .expect(409);

    const retry = await request(app.getHttpServer())
      .post('/bookings')
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
      .post('/bookings')
      .set(bearer(payer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    const heldForCancel = await request(app.getHttpServer())
      .post('/bookings')
      .set(bearer(canceller.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    await expire(app, heldForPayment.body.id);

    const unpaid = await request(app.getHttpServer())
      .post(`/bookings/${heldForPayment.body.id}/payment`)
      .set(bearer(payer.token))
      .expect(409);
    expect(unpaid.body.message).toBe('Reservation expired');
    expect(payments.confirm).not.toHaveBeenCalled();

    await expire(app, heldForCancel.body.id);
    const cancelled = await request(app.getHttpServer())
      .post(`/bookings/${heldForCancel.body.id}/cancel`)
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
          .post('/bookings')
          .set(bearer(customer.token))
          .send({
            eventId: event.id,
            quantity: customer === first ? 1 : 2,
          })
          .expect(201),
      ),
    );
    const other = await request(app.getHttpServer())
      .post('/bookings')
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
      .post('/bookings')
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
          .post('/bookings')
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
      .post('/bookings')
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
      .post('/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);

    payments.confirm.mockImplementation(async () => {
      await expire(app, reserved.body.id);
      await app.get(BookingsService).releaseExpiredHolds();
      return true;
    });

    const response = await request(app.getHttpServer())
      .post(`/bookings/${reserved.body.id}/payment`)
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
      .post('/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);

    const [paid, cancelled] = await Promise.all([
      request(app.getHttpServer())
        .post(`/bookings/${reserved.body.id}/payment`)
        .set(bearer(customer.token)),
      request(app.getHttpServer())
        .post(`/bookings/${reserved.body.id}/cancel`)
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
      .post('/bookings')
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

  it('cancels held and paid reservations when an admin deletes the event', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const holder = await loginAs(app, Role.CUSTOMER);
    const buyer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 4 }),
    );
    const held = await request(app.getHttpServer())
      .post('/bookings')
      .set(bearer(holder.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    const paid = await request(app.getHttpServer())
      .post('/bookings')
      .set(bearer(buyer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/bookings/${paid.body.id}/payment`)
      .set(bearer(buyer.token))
      .expect(200);
    await expire(app, held.body.id);

    await request(app.getHttpServer())
      .delete(`/events/${event.id}`)
      .set(bearer(admin.token))
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/events/${event.id}`)
      .set(bearer(admin.token))
      .expect(404);

    const prisma = app.get(PrismaService);
    const [heldBooking, paidBooking, storedEvent] = await Promise.all([
      prisma.booking.findUniqueOrThrow({ where: { id: held.body.id } }),
      prisma.booking.findUniqueOrThrow({ where: { id: paid.body.id } }),
      prisma.event.findUniqueOrThrow({ where: { id: event.id } }),
    ]);
    expect(heldBooking.status).toBe('EXPIRED');
    expect(paidBooking.status).toBe('REFUNDED');
    expect(storedEvent.deletedAt).not.toBeNull();
    expect(storedEvent.availableTickets).toBe(4);

    const audit = await request(app.getHttpServer())
      .get(`/events/${event.id}/bookings`)
      .set(bearer(admin.token))
      .expect(200);
    expect(audit.body.items.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining([held.body.id, paid.body.id]),
    );

    const catalog = await request(app.getHttpServer())
      .get('/events')
      .query({ limit: 100 })
      .set(bearer(holder.token))
      .expect(200);
    expect(
      catalog.body.items.map((item: { id: string }) => item.id),
    ).not.toContain(event.id);

    const mine = await request(app.getHttpServer())
      .get('/bookings')
      .set(bearer(holder.token))
      .expect(200);
    expect(mine.body.items).toEqual([
      expect.objectContaining({ id: held.body.id, status: 'EXPIRED' }),
    ]);

    await request(app.getHttpServer())
      .post('/bookings')
      .set(bearer(holder.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/bookings/${paid.body.id}/payment`)
      .set(bearer(buyer.token))
      .expect(409);
  });

  it('pages events with a cursor and keeps rows that share a start time', async () => {
    await clearCatalog(app);
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const sameStart = '2027-01-01T10:00:00.000Z';
    const first = await createEvent(
      app,
      admin.token,
      eventBody({ startsAt: sameStart }),
    );
    const second = await createEvent(
      app,
      admin.token,
      eventBody({ startsAt: sameStart }),
    );
    const third = await createEvent(
      app,
      admin.token,
      eventBody({ startsAt: '2027-01-02T10:00:00.000Z' }),
    );

    const seen: string[] = [];
    let cursor: string | null = null;
    const window = {
      from: '2027-01-01T00:00:00.000Z',
      to: '2027-01-03T00:00:00.000Z',
    };
    for (let page = 0; page < 3; page += 1) {
      const response = await request(app.getHttpServer())
        .get('/events')
        .query({ limit: 1, ...window, ...(cursor ? { cursor } : {}) })
        .set(bearer(customer.token))
        .expect(200);
      expect(response.body.items).toHaveLength(1);
      seen.push(response.body.items[0].id);
      cursor = response.body.nextCursor;
    }

    expect(seen).toEqual([[first.id, second.id].sort(), third.id].flat());
    expect(cursor).toBeNull();

    await request(app.getHttpServer())
      .get('/events')
      .query({ cursor: 'not-a-cursor' })
      .set(bearer(customer.token))
      .expect(400);
    await request(app.getHttpServer())
      .get('/events')
      .query({ limit: 101 })
      .set(bearer(customer.token))
      .expect(400);
  });

  it('pages a customer reservations from newest to oldest', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const other = await loginAs(app, Role.CUSTOMER);
    const ids: string[] = [];
    for (const createdAt of [
      '2026-03-01T00:00:00.000Z',
      '2026-03-02T00:00:00.000Z',
      '2026-03-03T00:00:00.000Z',
    ]) {
      const event = await createEvent(app, admin.token, eventBody());
      const reserved = await request(app.getHttpServer())
        .post('/bookings')
        .set(bearer(customer.token))
        .send({ eventId: event.id, quantity: 1 })
        .expect(201);
      await app.get(PrismaService).booking.update({
        where: { id: reserved.body.id },
        data: { createdAt: new Date(createdAt) },
      });
      ids.push(reserved.body.id);
    }
    const otherEvent = await createEvent(app, admin.token, eventBody());
    await request(app.getHttpServer())
      .post('/bookings')
      .set(bearer(other.token))
      .send({ eventId: otherEvent.id, quantity: 1 })
      .expect(201);

    const first = await request(app.getHttpServer())
      .get('/bookings')
      .query({ limit: 2 })
      .set(bearer(customer.token))
      .expect(200);
    expect(first.body.items.map((item: { id: string }) => item.id)).toEqual([
      ids[2],
      ids[1],
    ]);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await request(app.getHttpServer())
      .get('/bookings')
      .query({ limit: 2, cursor: first.body.nextCursor })
      .set(bearer(customer.token))
      .expect(200);
    expect(second.body.items.map((item: { id: string }) => item.id)).toEqual([
      ids[0],
    ]);
    expect(second.body.nextCursor).toBeNull();
  });

  it('replays a reservation for the same idempotency key', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const other = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 4 }),
    );
    const key = crypto.randomUUID();
    const body = { eventId: event.id, quantity: 1 };

    const first = await request(app.getHttpServer())
      .post('/bookings')
      .set(bearer(customer.token))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);

    const repeated = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app.getHttpServer())
          .post('/bookings')
          .set(bearer(customer.token))
          .set('Idempotency-Key', key)
          .send(body),
      ),
    );
    expect(repeated.map((response) => response.status)).toEqual([201, 201]);
    expect(repeated.map((response) => response.body.id)).toEqual([
      first.body.id,
      first.body.id,
    ]);

    const conflict = await request(app.getHttpServer())
      .post('/bookings')
      .set(bearer(customer.token))
      .set('Idempotency-Key', key)
      .send({ eventId: event.id, quantity: 2 })
      .expect(409);
    expect(conflict.body.message).toBe(
      'Idempotency key was reused for a different request',
    );

    const separate = await request(app.getHttpServer())
      .post('/bookings')
      .set(bearer(other.token))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(separate.body.id).not.toBe(first.body.id);

    const listed = await request(app.getHttpServer())
      .get(`/events/${event.id}`)
      .set(bearer(customer.token))
      .expect(200);
    expect(listed.body.availableTickets).toBe(2);

    await request(app.getHttpServer())
      .post('/bookings')
      .set(bearer(customer.token))
      .set('Idempotency-Key', 'has space')
      .send(body)
      .expect(400);
  });

  it('rejects an event that starts in the past or cannot be stored', async () => {
    const admin = await loginAs(app, Role.ADMIN);

    await request(app.getHttpServer())
      .post('/events')
      .set(bearer(admin.token))
      .send(eventBody({ startsAt: '2020-01-01T00:00:00.000Z' }))
      .expect(400);
    await request(app.getHttpServer())
      .post('/events')
      .set(bearer(admin.token))
      .send(eventBody({ totalTickets: 2_147_483_648 }))
      .expect(400);
    await request(app.getHttpServer())
      .post('/events')
      .set(bearer(admin.token))
      .send(eventBody({ ticketPrice: 100_000_000 }))
      .expect(400);
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
      .post('/bookings')
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

  it('stops one customer from reserving every remaining ticket', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const first = await loginAs(app, Role.CUSTOMER);
    const second = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 12 }),
    );

    await request(app.getHttpServer())
      .post('/bookings')
      .set(bearer(first.token))
      .send({ eventId: event.id, quantity: 10 })
      .expect(201);
    const blocked = await request(app.getHttpServer())
      .post('/bookings')
      .set(bearer(first.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(409);
    expect(blocked.body.message).toBe(
      'You can reserve at most 10 tickets for an event',
    );

    const other = await request(app.getHttpServer())
      .post('/bookings')
      .set(bearer(second.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    expect(other.body.event.availableTickets).toBe(1);
  });

  it('ends a hold when the event starts, even inside the 30 minute window', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const startsAt = new Date(Date.now() + 60_000).toISOString();
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ startsAt, totalTickets: 2 }),
    );

    const reserved = await request(app.getHttpServer())
      .post('/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);

    const expiresAt = new Date(reserved.body.expiresAt).getTime();
    expect(expiresAt).toBeLessThanOrEqual(new Date(startsAt).getTime());
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it('hides events that have already started unless the caller asks for them', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const upcoming = await createEvent(app, admin.token, eventBody());
    const past = await createEvent(app, admin.token, eventBody());
    await app.get(PrismaService).event.update({
      where: { id: past.id },
      data: { startsAt: new Date('2020-01-01T00:00:00.000Z') },
    });

    const listed = await request(app.getHttpServer())
      .get('/events')
      .query({ limit: 100 })
      .set(bearer(customer.token))
      .expect(200);
    const ids = listed.body.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(upcoming.id);
    expect(ids).not.toContain(past.id);

    const ranged = await request(app.getHttpServer())
      .get('/events')
      .query({
        limit: 100,
        from: '2019-01-01T00:00:00.000Z',
        to: '2021-01-01T00:00:00.000Z',
      })
      .set(bearer(customer.token))
      .expect(200);
    expect(ranged.body.items.map((item: { id: string }) => item.id)).toContain(
      past.id,
    );
  });
});

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function eventBody(overrides: Record<string, unknown> = {}) {
  return {
    title: `test-event-${crypto.randomUUID()}`,
    description: 'An evening of talks.',
    venue: 'Kadikoy',
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    ticketPrice: 25,
    totalTickets: 2,
    ...overrides,
  };
}

async function createEvent(
  app: INestApplication<App>,
  token: string,
  body: ReturnType<typeof eventBody>,
) {
  const response = await request(app.getHttpServer())
    .post('/events')
    .set(bearer(token))
    .send(body)
    .expect(201);
  return response.body as { id: string };
}

async function clearCatalog(app: INestApplication<App>) {
  const prisma = app.get(PrismaService);
  await prisma.paymentAttempt.deleteMany({
    where: { booking: { event: { title: { startsWith: 'test-event-' } } } },
  });
  await prisma.booking.deleteMany({
    where: { event: { title: { startsWith: 'test-event-' } } },
  });
  await prisma.event.deleteMany({
    where: { title: { startsWith: 'test-event-' } },
  });
}

async function expire(app: INestApplication<App>, bookingId: string) {
  await app.get(PrismaService).booking.update({
    where: { id: bookingId },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  });
}

async function loginAs(app: INestApplication<App>, role: Role) {
  const email = `ada-${crypto.randomUUID()}@example.test`;
  const password = 'correct horse battery';
  await app.get(PrismaService).user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 4),
      role,
    },
  });
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);
  return { token: response.body.accessToken as string, email };
}
