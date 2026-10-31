import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types.js';
import type { EnvironmentVariables } from '../src/config/env.validation.js';
import { Role } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { signPaymentWebhook } from '../src/webhooks/payment-signature.js';
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

describe('Payment webhooks (e2e)', () => {
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

  it('rejects a missing, forged, or malformed webhook', async () => {
    const unsigned = await request(app.getHttpServer())
      .post('/api/v1/webhooks/payments')
      .set('content-type', 'application/json')
      .send({ idempotencyKey: 'missing', paid: true })
      .expect(401);
    expect(unsigned.body.code).toBe('INVALID_WEBHOOK_SIGNATURE');

    const forged = await request(app.getHttpServer())
      .post('/api/v1/webhooks/payments')
      .set('content-type', 'application/json')
      .set('x-payment-signature', 'a'.repeat(64))
      .send({ idempotencyKey: 'missing', paid: true })
      .expect(401);
    expect(forged.body.code).toBe('INVALID_WEBHOOK_SIGNATURE');

    const secret = webhookSecret(app);
    const invalidJson = Buffer.from('{');
    const badJson = await request(app.getHttpServer())
      .post('/api/v1/webhooks/payments')
      .set('content-type', 'application/json')
      .set('x-payment-signature', signPaymentWebhook(secret, invalidJson))
      .send(invalidJson.toString('utf8'))
      .expect(400);
    expect(badJson.body.code).toBe('BAD_REQUEST');

    const invalidBody = Buffer.from(
      JSON.stringify({ idempotencyKey: '', paid: true }),
    );
    const badBody = await request(app.getHttpServer())
      .post('/api/v1/webhooks/payments')
      .set('content-type', 'application/json')
      .set('x-payment-signature', signPaymentWebhook(secret, invalidBody))
      .send(invalidBody.toString('utf8'))
      .expect(400);
    expect(badBody.body.code).toBe('INVALID_WEBHOOK');

    const unknown = Buffer.from(
      JSON.stringify({ idempotencyKey: 'does-not-exist', paid: true }),
    );
    const missing = await request(app.getHttpServer())
      .post('/api/v1/webhooks/payments')
      .set('content-type', 'application/json')
      .set('x-payment-signature', signPaymentWebhook(secret, unknown))
      .send(unknown.toString('utf8'))
      .expect(404);
    expect(missing.body.code).toBe('PAYMENT_ATTEMPT_NOT_FOUND');
  });

  it('ignores a repeated webhook after the charge is already applied', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(app, admin.token, eventBody());
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/payment`)
      .set(bearer(customer.token))
      .expect(200);

    const raw = Buffer.from(
      JSON.stringify({ idempotencyKey: reserved.body.id, paid: true }),
    );
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/payments')
      .set('content-type', 'application/json')
      .set('x-payment-signature', signPaymentWebhook(webhookSecret(app), raw))
      .send(raw.toString('utf8'))
      .expect(204);

    const stored = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
      include: { event: true },
    });
    expect(stored.status).toBe('PAID');
    expect(stored.event.availableTickets).toBe(1);
  });

  it('marks a pending attempt declined when the webhook says it was not paid', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(app, admin.token, eventBody());
    const reserved = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    await app.get(PrismaService).paymentAttempt.create({
      data: {
        bookingId: reserved.body.id,
        idempotencyKey: reserved.body.id,
        amount: '25.00',
        state: 'PENDING',
      },
    });

    const raw = Buffer.from(
      JSON.stringify({ idempotencyKey: reserved.body.id, paid: false }),
    );
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/payments')
      .set('content-type', 'application/json')
      .set('x-payment-signature', signPaymentWebhook(webhookSecret(app), raw))
      .send(raw.toString('utf8'))
      .expect(204);

    const stored = await app
      .get(PrismaService)
      .paymentAttempt.findUniqueOrThrow({
        where: { idempotencyKey: reserved.body.id },
      });
    expect(stored.state).toBe('DECLINED');
    const booking = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
    });
    expect(booking.status).toBe('HELD');
  });
});

function webhookSecret(app: INestApplication<App>) {
  return app
    .get(ConfigService<EnvironmentVariables, true>)
    .get('PAYMENT_WEBHOOK_SECRET', { infer: true });
}
