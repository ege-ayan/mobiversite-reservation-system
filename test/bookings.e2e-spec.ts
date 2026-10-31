import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { Role } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  bearer,
  bootReservationApp,
  createEvent,
  eventBody,
  loginAs,
  resetPayments,
  shutdownReservationApp,
  type PaymentDoubles,
} from './support/reservation-harness.js';

describe('Bookings (e2e)', () => {
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

  it('holds tickets, confirms payment, and returns them on cancel', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 2 }),
    );

    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(admin.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(403);

    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);

    expect(reserved.body.status).toBe('HELD');
    expect(reserved.body.event.availableTickets).toBe(1);

    const mine = await request(app.getHttpServer())
      .get('/api/v1/bookings')
      .set(bearer(customer.token))
      .expect(200);
    expect(mine.body.items).toHaveLength(1);

    const paid = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/payment`)
      .set(bearer(customer.token))
      .expect(200);

    expect(paid.body.status).toBe('PAID');
    expect(payments.confirm).toHaveBeenCalledWith({
      bookingId: reserved.body.id,
      amount: '25.00',
      idempotencyKey: reserved.body.id,
      decision: undefined,
    });

    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/cancel`)
      .set(bearer(customer.token))
      .expect(200);

    expect(cancelled.body.status).toBe('REFUNDED');
    expect(cancelled.body.event.availableTickets).toBe(2);

    const one = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${reserved.body.id}`)
      .set(bearer(customer.token))
      .expect(200);
    expect(one.body.status).toBe('REFUNDED');

    const forAdmin = await request(app.getHttpServer())
      .get(`/api/v1/events/${event.id}/bookings`)
      .set(bearer(admin.token))
      .expect(200);
    expect(forAdmin.body.items).toEqual([
      expect.objectContaining({
        id: reserved.body.id,
        userEmail: customer.email,
      }),
    ]);
    await request(app.getHttpServer())
      .get(`/api/v1/events/${event.id}/bookings`)
      .set(bearer(customer.token))
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/cancel`)
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
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);

    payments.confirm.mockResolvedValue(false);
    const declined = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/payment`)
      .set(bearer(customer.token))
      .expect(409);

    expect(declined.body.message).toBe('Payment was not confirmed');

    const stored = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
    });
    expect(stored.status).toBe('HELD');
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
        .post('/api/v1/bookings')
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
      .post('/api/v1/bookings')
      .set(bearer(other.token))
      .send({ eventId: otherEvent.id, quantity: 1 })
      .expect(201);

    const first = await request(app.getHttpServer())
      .get('/api/v1/bookings')
      .query({ limit: 2 })
      .set(bearer(customer.token))
      .expect(200);
    expect(first.body.items.map((item: { id: string }) => item.id)).toEqual([
      ids[2],
      ids[1],
    ]);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await request(app.getHttpServer())
      .get('/api/v1/bookings')
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
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);

    const repeated = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/bookings')
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
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .set('Idempotency-Key', key)
      .send({ eventId: event.id, quantity: 2 })
      .expect(409);
    expect(conflict.body.message).toBe(
      'Idempotency key was reused for a different request',
    );

    const separate = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(other.token))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(separate.body.id).not.toBe(first.body.id);

    const listed = await request(app.getHttpServer())
      .get(`/api/v1/events/${event.id}`)
      .set(bearer(customer.token))
      .expect(200);
    expect(listed.body.availableTickets).toBe(2);

    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .set('Idempotency-Key', 'has space')
      .send(body)
      .expect(400);
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
      .post('/api/v1/bookings')
      .set(bearer(first.token))
      .send({ eventId: event.id, quantity: 10 })
      .expect(201);
    const blocked = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(first.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(409);
    expect(blocked.body.message).toBe(
      'You can reserve at most 10 tickets for an event',
    );

    const other = await request(app.getHttpServer())
      .post('/api/v1/bookings')
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
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);

    const expiresAt = new Date(reserved.body.expiresAt).getTime();
    expect(expiresAt).toBeLessThanOrEqual(new Date(startsAt).getTime());
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it('rejects a reservation that is not a real hold', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const missing = '00000000-0000-7000-8000-000000000099';

    await request(app.getHttpServer()).post('/api/v1/bookings').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/bookings')
      .set(bearer(admin.token))
      .expect(403);

    const bodies = [
      { eventId: missing, quantity: 0 },
      { eventId: missing, quantity: 11 },
      { eventId: missing, quantity: 101 },
      { eventId: missing, quantity: 1.5 },
      { eventId: 'not-a-uuid', quantity: 1 },
      { quantity: 1 },
    ];
    for (const body of bodies) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set(bearer(customer.token))
        .send(body)
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    }

    const unknown = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: missing, quantity: 1 })
      .expect(404);
    expect(unknown.body.code).toBe('EVENT_NOT_FOUND');
    await request(app.getHttpServer())
      .get(`/api/v1/bookings/${missing}`)
      .set(bearer(customer.token))
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/bookings/not-a-uuid')
      .set(bearer(customer.token))
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/bookings')
      .query({ cursor: 'not-a-cursor' })
      .set(bearer(customer.token))
      .expect(400);
  });

  it('hides a reservation from every other customer', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const owner = await loginAs(app, Role.CUSTOMER);
    const stranger = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(app, admin.token, eventBody());
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(owner.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/bookings/${reserved.body.id}`)
      .set(bearer(stranger.token))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/payment`)
      .set(bearer(stranger.token))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/cancel`)
      .set(bearer(stranger.token))
      .expect(404);

    const theirs = await request(app.getHttpServer())
      .get('/api/v1/bookings')
      .set(bearer(stranger.token))
      .expect(200);
    expect(theirs.body.items).toEqual([]);
  });

  it('cancels a hold once and then refuses payment and a second cancel', async () => {
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

    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/cancel`)
      .set(bearer(customer.token))
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.event.availableTickets).toBe(2);

    const again = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/cancel`)
      .set(bearer(customer.token))
      .expect(409);
    expect(again.body.code).toBe('BOOKING_CLOSED');
    const payment = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/payment`)
      .set(bearer(customer.token))
      .expect(409);
    expect(payment.body.code).toBe('BOOKING_NOT_PAYABLE');
    expect(payments.confirm).not.toHaveBeenCalled();
  });

  it('pays a held reservation only once and keeps the price from reserve time', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ ticketPrice: 25, totalTickets: 2 }),
    );
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 2 })
      .expect(201);
    await request(app.getHttpServer())
      .put(`/api/v1/events/${event.id}`)
      .set(bearer(admin.token))
      .send(eventBody({ title: event.title, ticketPrice: 40, totalTickets: 4 }))
      .expect(200);

    const paid = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/payment`)
      .set(bearer(customer.token))
      .expect(200);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.ticketPrice).toBe('25.00');
    expect(payments.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '50.00' }),
    );

    payments.confirm.mockClear();
    const repeated = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/payment`)
      .set(bearer(customer.token))
      .expect(200);
    expect(repeated.body.status).toBe('PAID');
    expect(payments.confirm).not.toHaveBeenCalled();
  });

  it('keeps a paid reservation when the refund is declined', async () => {
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
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/payment`)
      .set(bearer(customer.token))
      .expect(200);

    payments.refund.mockResolvedValue(false);
    const failed = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/cancel`)
      .set(bearer(customer.token))
      .expect(502);
    expect(failed.body.code).toBe('REFUND_FAILED');
    const stuck = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
      include: { event: true },
    });
    expect(stuck.status).toBe('PAID');
    expect(stuck.event.availableTickets).toBe(0);

    payments.refund.mockResolvedValue(true);
    const refunded = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/cancel`)
      .set(bearer(customer.token))
      .expect(200);
    expect(refunded.body.status).toBe('REFUNDED');
    expect(refunded.body.event.availableTickets).toBe(1);
  });

  it('frees a cancelled hold from the per-customer cap and keeps a paid one', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 20 }),
    );
    const held = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 10 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${held.body.id}/cancel`)
      .set(bearer(customer.token))
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 10 })
      .expect(201);

    const paidEvent = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 20 }),
    );
    const paid = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: paidEvent.id, quantity: 10 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${paid.body.id}/payment`)
      .set(bearer(customer.token))
      .expect(200);
    const blocked = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: paidEvent.id, quantity: 1 })
      .expect(409);
    expect(blocked.body.code).toBe('TICKET_LIMIT');
  });

  it('refuses a hold on a closed or already started event and a sold-out event', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const first = await loginAs(app, Role.CUSTOMER);
    const second = await loginAs(app, Role.CUSTOMER);
    const closed = await createEvent(app, admin.token, eventBody());
    await app.get(PrismaService).event.update({
      where: { id: closed.id },
      data: { salesClosedAt: new Date() },
    });
    const closedResponse = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(first.token))
      .send({ eventId: closed.id, quantity: 1 })
      .expect(404);
    expect(closedResponse.body.code).toBe('EVENT_NOT_FOUND');

    const started = await createEvent(app, admin.token, eventBody());
    await app.get(PrismaService).event.update({
      where: { id: started.id },
      data: { startsAt: new Date(Date.now() - 60_000) },
    });
    const startedResponse = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(first.token))
      .send({ eventId: started.id, quantity: 1 })
      .expect(400);
    expect(startedResponse.body.code).toBe('EVENT_STARTED');

    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 1 }),
    );
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(first.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    const soldOut = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(second.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(409);
    expect(soldOut.body.code).toBe('SOLD_OUT');
  });

  it('rejects a bad idempotency key and replays a maximum-length key', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 3 }),
    );
    const body = { eventId: event.id, quantity: 1 };
    for (const key of ['', 'has/slash', 'a'.repeat(256)]) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set(bearer(customer.token))
        .set('Idempotency-Key', key)
        .send(body)
        .expect(400);
      expect(response.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
    }

    const key = 'k'.repeat(255);
    const created = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(replay.body.id).toBe(created.body.id);
    const stored = await app.get(PrismaService).event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(stored.availableTickets).toBe(2);
  });

  it('holds a far-future event for the configured payment window', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(app, admin.token, eventBody());
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);

    const holdMs = 30 * 60 * 1000;
    const remaining = new Date(reserved.body.expiresAt).getTime() - Date.now();
    expect(remaining).toBeLessThanOrEqual(holdMs);
    expect(remaining).toBeGreaterThan(holdMs - 10_000);
  });
});
