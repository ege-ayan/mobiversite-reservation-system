import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types.js';

import type { EnvironmentVariables } from '@/config/env.validation.js';
import { EventCancellationService } from '@/events/event-cancellation.service.js';
import { Role } from '@/generated/prisma/client.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { signPaymentWebhook } from '@/webhooks/payment-signature.js';

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

describe('Reservation races (e2e)', () => {
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

  it('sells a multi-ticket hold only while stock still covers the quantity', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 5 }),
    );
    const buyers = await Promise.all(
      Array.from({ length: 4 }, () => loginAs(app, Role.CUSTOMER)),
    );

    const attempts = await Promise.all(
      buyers.map((buyer) =>
        request(app.getHttpServer())
          .post('/api/v1/bookings')
          .set(bearer(buyer.token))
          .send({ eventId: event.id, quantity: 2 }),
      ),
    );

    const created = attempts.filter((response) => response.status === 201);
    const rejected = attempts.filter((response) => response.status === 409);
    expect(created).toHaveLength(2);
    expect(rejected).toHaveLength(2);
    expect(rejected.map((response) => response.body.code)).toEqual([
      'SOLD_OUT',
      'SOLD_OUT',
    ]);
    await expectConserved(app, event.id);
    const stored = await app.get(PrismaService).event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(stored.availableTickets).toBe(1);
  });

  it('keeps one customer inside the ticket cap when reserves overlap', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 40 }),
    );

    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/bookings')
          .set(bearer(customer.token))
          .send({ eventId: event.id, quantity: 4 }),
      ),
    );

    const created = attempts.filter((response) => response.status === 201);
    const rejected = attempts.filter((response) => response.status === 409);
    expect(created).toHaveLength(2);
    expect(rejected.map((response) => response.body.code)).toEqual([
      'TICKET_LIMIT',
      'TICKET_LIMIT',
      'TICKET_LIMIT',
      'TICKET_LIMIT',
    ]);
    const held = await app.get(PrismaService).booking.aggregate({
      where: { eventId: event.id, status: 'HELD' },
      _sum: { quantity: true },
    });
    expect(held._sum.quantity).toBe(8);
    await expectConserved(app, event.id);
  });

  it('creates one booking when the same idempotency key arrives together', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 8 }),
    );
    const key = crypto.randomUUID();
    const body = { eventId: event.id, quantity: 2 };

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/bookings')
          .set(bearer(customer.token))
          .set('Idempotency-Key', key)
          .send(body),
      ),
    );

    expect(attempts.map((response) => response.status)).toEqual(
      Array.from({ length: 8 }, () => 201),
    );
    const ids = new Set(attempts.map((response) => response.body.id as string));
    expect(ids.size).toBe(1);
    const stored = await app.get(PrismaService).booking.findMany({
      where: { eventId: event.id },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.quantity).toBe(2);
    await expectConserved(app, event.id);
    const inventory = await app.get(PrismaService).event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(inventory.availableTickets).toBe(6);
  });

  it('drops in-flight holds when sales close during the rush', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 8 }),
    );
    const buyers = await Promise.all(
      Array.from({ length: 8 }, () => loginAs(app, Role.CUSTOMER)),
    );

    const [deletion, ...attempts] = await Promise.all([
      request(app.getHttpServer())
        .delete(`/api/v1/events/${event.id}`)
        .set(bearer(admin.token)),
      ...buyers.map((buyer) =>
        request(app.getHttpServer())
          .post('/api/v1/bookings')
          .set(bearer(buyer.token))
          .send({ eventId: event.id, quantity: 1 }),
      ),
    ]);

    expect(deletion.status).toBe(202);
    expect(
      attempts.every(
        (response) => response.status === 201 || response.status === 404,
      ),
    ).toBe(true);
    await app.get(EventCancellationService).processOne(event.id);

    const prisma = app.get(PrismaService);
    const [stored, open] = await Promise.all([
      prisma.event.findUniqueOrThrow({ where: { id: event.id } }),
      prisma.booking.count({
        where: { eventId: event.id, status: { in: ['HELD', 'PAID'] } },
      }),
    ]);
    expect(stored.deletedAt).not.toBeNull();
    expect(open).toBe(0);
    expect(stored.availableTickets).toBe(stored.totalTickets);
    await expectConserved(app, event.id);
  });

  it('keeps the ticket equation when capacity shrinks during a sale', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const draft = eventBody({ totalTickets: 10 });
    const event = await createEvent(app, admin.token, draft);
    const buyers = await Promise.all(
      Array.from({ length: 6 }, () => loginAs(app, Role.CUSTOMER)),
    );

    const [update, ...attempts] = await Promise.all([
      request(app.getHttpServer())
        .put(`/api/v1/events/${event.id}`)
        .set(bearer(admin.token))
        .send({ ...draft, totalTickets: 4 }),
      ...buyers.map((buyer) =>
        request(app.getHttpServer())
          .post('/api/v1/bookings')
          .set(bearer(buyer.token))
          .send({ eventId: event.id, quantity: 2 }),
      ),
    ]);

    expect([200, 409]).toContain(update.status);
    if (update.status === 409) {
      expect(update.body.code).toBe('CAPACITY_BELOW_RESERVED');
    }
    expect(
      attempts.every(
        (response) => response.status === 201 || response.status === 409,
      ),
    ).toBe(true);
    await expectConserved(app, event.id);
    const stored = await app.get(PrismaService).event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(stored.availableTickets).toBeGreaterThanOrEqual(0);
    expect(stored.availableTickets).toBeLessThanOrEqual(stored.totalTickets);
  });

  it('charges a booking once when two payments overlap', async () => {
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

    let releaseConfirm: () => void = () => undefined;
    const confirmGate = new Promise<void>((resolve) => {
      releaseConfirm = resolve;
    });
    let markEntered: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    payments.confirm.mockImplementation(() => {
      markEntered();
      return confirmGate.then(() => true);
    });

    const first = request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/payment`)
      .set(bearer(customer.token))
      .then((response) => response);
    await entered;
    const second = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/payment`)
      .set(bearer(customer.token));
    releaseConfirm();
    const paid = await first;

    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('PAID');
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('PAYMENT_IN_PROGRESS');
    expect(payments.confirm).toHaveBeenCalledTimes(1);
    expect(payments.refund).not.toHaveBeenCalled();
    await expectConserved(app, event.id);
  });

  it('returns tickets once when the same hold is cancelled twice at once', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 3 }),
    );
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 2 })
      .expect(201);

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/bookings/${reserved.body.id}/cancel`)
        .set(bearer(customer.token)),
      request(app.getHttpServer())
        .post(`/api/v1/bookings/${reserved.body.id}/cancel`)
        .set(bearer(customer.token)),
    ]);

    expect(
      [first.status, second.status].sort((left, right) => left - right),
    ).toEqual([200, 409]);
    const stored = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
      include: { event: true },
    });
    expect(stored.status).toBe('CANCELLED');
    expect(stored.event.availableTickets).toBe(3);
    await expectConserved(app, event.id);
  });

  it('returns a paid ticket once when two refunds race', async () => {
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
    payments.refund.mockClear();

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/bookings/${reserved.body.id}/cancel`)
        .set(bearer(customer.token)),
      request(app.getHttpServer())
        .post(`/api/v1/bookings/${reserved.body.id}/cancel`)
        .set(bearer(customer.token)),
    ]);

    expect(
      [first.status, second.status].every(
        (status) => status === 200 || status === 409,
      ),
    ).toBe(true);
    expect([first.status, second.status]).toContain(200);
    const stored = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
      include: { event: true },
    });
    expect(stored.status).toBe('REFUNDED');
    expect(stored.event.availableTickets).toBe(1);
    expect(payments.refund.mock.calls.length).toBeGreaterThan(0);
    expect(payments.refund.mock.calls.length).toBeLessThanOrEqual(2);
    await expectConserved(app, event.id);
  });

  it('returns a paid ticket once when the buyer and the event cancellation both refund', async () => {
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
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/payment`)
      .set(bearer(customer.token))
      .expect(200);
    payments.refund.mockClear();

    const [cancelResponse, deletion] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/bookings/${reserved.body.id}/cancel`)
        .set(bearer(customer.token)),
      request(app.getHttpServer())
        .delete(`/api/v1/events/${event.id}`)
        .set(bearer(admin.token)),
    ]);
    await app.get(EventCancellationService).processOne(event.id);

    expect(deletion.status).toBe(202);
    expect([200, 409]).toContain(cancelResponse.status);
    const stored = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
      include: { event: true },
    });
    expect(stored.status).toBe('REFUNDED');
    expect(stored.event.deletedAt).not.toBeNull();
    expect(stored.event.availableTickets).toBe(2);
    expect(payments.refund.mock.calls.length).toBeGreaterThan(0);
    expect(payments.refund.mock.calls.length).toBeLessThanOrEqual(2);
    await expectConserved(app, event.id);
  });

  it('applies one charge when the webhook arrives during payment', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 3 }),
    );
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 2 })
      .expect(201);

    let idempotencyKey = '';
    let releaseConfirm: () => void = () => undefined;
    const confirmGate = new Promise<void>((resolve) => {
      releaseConfirm = resolve;
    });
    let markEntered: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    payments.confirm.mockImplementation(
      (payment: { idempotencyKey: string }) => {
        idempotencyKey = payment.idempotencyKey;
        markEntered();
        return confirmGate.then(() => true);
      },
    );

    const paidDone = request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/payment`)
      .set(bearer(customer.token))
      .then((response) => response);
    await entered;
    const notifiedDone = postWebhook(app, idempotencyKey).then(
      (response) => response,
    );
    releaseConfirm();
    const [paid, notified] = await Promise.all([paidDone, notifiedDone]);

    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('PAID');
    expect(notified?.status).toBe(204);
    expect(payments.confirm).toHaveBeenCalledTimes(1);
    expect(payments.refund).not.toHaveBeenCalled();
    const stored = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
      include: { event: true, paymentAttempts: true },
    });
    expect(stored.status).toBe('PAID');
    expect(stored.event.availableTickets).toBe(1);
    expect(stored.paymentAttempts.map((attempt) => attempt.state)).toEqual([
      'APPLIED',
    ]);
    await expectConserved(app, event.id);
  });
});

async function expectConserved(app: INestApplication<App>, eventId: string) {
  const prisma = app.get(PrismaService);
  const [event, bookings] = await Promise.all([
    prisma.event.findUniqueOrThrow({ where: { id: eventId } }),
    prisma.booking.findMany({
      where: { eventId },
      select: { status: true, quantity: true },
    }),
  ]);
  const open = bookings
    .filter((booking) => booking.status === 'HELD' || booking.status === 'PAID')
    .reduce((sum, booking) => sum + booking.quantity, 0);
  expect(event.availableTickets + open).toBe(event.totalTickets);
}

function postWebhook(app: INestApplication<App>, idempotencyKey: string) {
  const raw = Buffer.from(JSON.stringify({ idempotencyKey, paid: true }));
  const secret = app
    .get(ConfigService<EnvironmentVariables, true>)
    .get('PAYMENT_WEBHOOK_SECRET', { infer: true });
  return request(app.getHttpServer())
    .post('/api/v1/webhooks/payments')
    .set('content-type', 'application/json')
    .set('x-payment-signature', signPaymentWebhook(secret, raw))
    .send(raw.toString('utf8'));
}
