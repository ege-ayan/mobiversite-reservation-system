import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { EventCancellationService } from '../src/events/event-cancellation.service.js';
import { Role } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
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

describe('Event cancellation (e2e)', () => {
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
      .post('/api/v1/bookings')
      .set(bearer(holder.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    const paid = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(buyer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${paid.body.id}/payment`)
      .set(bearer(buyer.token))
      .expect(200);
    await expire(app, held.body.id);

    await request(app.getHttpServer())
      .delete(`/api/v1/events/${event.id}`)
      .set(bearer(admin.token))
      .expect(202);
    await app.get(EventCancellationService).processOne(event.id);
    await request(app.getHttpServer())
      .delete(`/api/v1/events/${event.id}`)
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
      .get(`/api/v1/events/${event.id}/bookings`)
      .set(bearer(admin.token))
      .expect(200);
    expect(audit.body.items.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining([held.body.id, paid.body.id]),
    );

    const catalog = await request(app.getHttpServer())
      .get('/api/v1/events')
      .query({ limit: 100 })
      .set(bearer(holder.token))
      .expect(200);
    expect(
      catalog.body.items.map((item: { id: string }) => item.id),
    ).not.toContain(event.id);

    const mine = await request(app.getHttpServer())
      .get('/api/v1/bookings')
      .set(bearer(holder.token))
      .expect(200);
    expect(mine.body.items).toEqual([
      expect.objectContaining({ id: held.body.id, status: 'EXPIRED' }),
    ]);

    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(holder.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${paid.body.id}/payment`)
      .set(bearer(buyer.token))
      .expect(409);
  });

  it('rejects a delete from the wrong caller and an unknown event', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(app, admin.token, eventBody());
    const missing = '00000000-0000-7000-8000-000000000099';

    await request(app.getHttpServer())
      .delete(`/api/v1/events/${event.id}`)
      .expect(401);
    await request(app.getHttpServer())
      .delete(`/api/v1/events/${event.id}`)
      .set(bearer(customer.token))
      .expect(403);
    await request(app.getHttpServer())
      .delete('/api/v1/events/not-a-uuid')
      .set(bearer(admin.token))
      .expect(400);
    const unknown = await request(app.getHttpServer())
      .delete(`/api/v1/events/${missing}`)
      .set(bearer(admin.token))
      .expect(404);
    expect(unknown.body.code).toBe('EVENT_NOT_FOUND');
  });

  it('closes sales immediately and refunds the paid hold once cancellation finishes', async () => {
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

    await request(app.getHttpServer())
      .delete(`/api/v1/events/${event.id}`)
      .set(bearer(admin.token))
      .expect(202);
    const closed = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 1 })
      .expect(404);
    expect(closed.body.code).toBe('EVENT_NOT_FOUND');

    await app.get(EventCancellationService).processOne(event.id);
    const refunded = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
    });
    expect(refunded.status).toBe('REFUNDED');
    const again = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reserved.body.id}/payment`)
      .set(bearer(customer.token))
      .expect(409);
    expect(again.body.code).toBe('BOOKING_NOT_PAYABLE');
  });

  it('leaves the event cancelling when the refund fails, then finishes on retry', async () => {
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
    await app.get(PrismaService).event.update({
      where: { id: event.id },
      data: { salesClosedAt: new Date() },
    });

    payments.refund.mockResolvedValue(false);
    await expect(
      app.get(EventCancellationService).processOne(event.id),
    ).rejects.toThrow(/Refund was not confirmed/);
    const mid = await app.get(PrismaService).event.findUniqueOrThrow({
      where: { id: event.id },
    });
    const stillPaid = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
    });
    expect(mid.deletedAt).toBeNull();
    expect(stillPaid.status).toBe('PAID');

    payments.refund.mockResolvedValue(true);
    await app.get(EventCancellationService).processOne(event.id);
    const done = await app.get(PrismaService).event.findUniqueOrThrow({
      where: { id: event.id },
    });
    const refunded = await app.get(PrismaService).booking.findUniqueOrThrow({
      where: { id: reserved.body.id },
    });
    expect(done.deletedAt).not.toBeNull();
    expect(refunded.status).toBe('REFUNDED');
    expect(done.availableTickets).toBe(1);
  });
});
