import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';

import { EventCancellationService } from '@/events/event-cancellation.service.js';
import { Role } from '@/generated/prisma/client.js';
import { PrismaService } from '@/prisma/prisma.service.js';

import {
  bearer,
  bootReservationApp,
  clearCatalog,
  createEvent,
  eventBody,
  loginAs,
  resetPayments,
  shutdownReservationApp,
  type PaymentDoubles,
} from './support/reservation-harness.js';

describe('Events (e2e)', () => {
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

  it('lets an admin manage events and a customer read them', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const body = eventBody();

    await request(app.getHttpServer())
      .post('/api/v1/events')
      .send(body)
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/events')
      .set(bearer(customer.token))
      .send(body)
      .expect(403);

    const created = await request(app.getHttpServer())
      .post('/api/v1/events')
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
      .put(`/api/v1/events/${created.body.id}`)
      .set(bearer(admin.token))
      .send(replacement)
      .expect(200);

    expect(updated.body.venue).toBe('Besiktas');
    expect(updated.body.totalTickets).toBe(8);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/events')
      .set(bearer(customer.token))
      .expect(200);

    expect(listed.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.body.id, venue: 'Besiktas' }),
      ]),
    );

    const adminView = await request(app.getHttpServer())
      .get(`/api/v1/admin/events/${created.body.id}`)
      .set(bearer(admin.token))
      .expect(200);
    expect(adminView.body).toMatchObject({
      status: 'ON_SALE',
      paidRevenue: '0.00',
      heldTickets: 0,
    });
    await request(app.getHttpServer())
      .get('/api/v1/admin/events')
      .set(bearer(customer.token))
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/events/${created.body.id}`)
      .set(bearer(customer.token))
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/events/${created.body.id}`)
      .set(bearer(admin.token))
      .expect(202);
    await app.get(EventCancellationService).processOne(created.body.id);

    await request(app.getHttpServer())
      .get(`/api/v1/events/${created.body.id}`)
      .set(bearer(customer.token))
      .expect(404);
    const hidden = await request(app.getHttpServer())
      .get(`/api/v1/admin/events/${created.body.id}`)
      .set(bearer(admin.token))
      .expect(200);
    expect(hidden.body.status).toBe('DELETED');
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
      const response: {
        body: { items: { id: string }[]; nextCursor: string | null };
      } = await request(app.getHttpServer())
        .get('/api/v1/events')
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
      .get('/api/v1/events')
      .query({ cursor: 'not-a-cursor' })
      .set(bearer(customer.token))
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/events')
      .query({ limit: 101 })
      .set(bearer(customer.token))
      .expect(400);
  });

  it('rejects an event that starts in the past or cannot be stored', async () => {
    const admin = await loginAs(app, Role.ADMIN);

    await request(app.getHttpServer())
      .post('/api/v1/events')
      .set(bearer(admin.token))
      .send(eventBody({ startsAt: '2020-01-01T00:00:00.000Z' }))
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/events')
      .set(bearer(admin.token))
      .send(eventBody({ totalTickets: 2_147_483_648 }))
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/events')
      .set(bearer(admin.token))
      .send(eventBody({ ticketPrice: 100_000_000 }))
      .expect(400);
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
      .get('/api/v1/events')
      .query({ limit: 100 })
      .set(bearer(customer.token))
      .expect(200);
    const ids = listed.body.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(upcoming.id);
    expect(ids).not.toContain(past.id);

    const ranged = await request(app.getHttpServer())
      .get('/api/v1/events')
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

  it('accepts a title search that contains boolean operators', async () => {
    const customer = await loginAs(app, Role.CUSTOMER);

    await request(app.getHttpServer())
      .get('/api/v1/events')
      .query({ q: 'live(' })
      .set(bearer(customer.token))
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/events')
      .query({ q: '+-~' })
      .set(bearer(customer.token))
      .expect(200);
  });

  it('rejects catalog and admin calls that are unauthenticated or the wrong role', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(app, admin.token, eventBody());

    await request(app.getHttpServer()).get('/api/v1/events').expect(401);
    await request(app.getHttpServer())
      .get(`/api/v1/events/${event.id}`)
      .expect(401);
    await request(app.getHttpServer())
      .put(`/api/v1/events/${event.id}`)
      .set(bearer(customer.token))
      .send(eventBody({ title: event.title }))
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/admin/events')
      .set(bearer(customer.token))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/admin/events/${event.id}`)
      .set(bearer(customer.token))
      .expect(403);
  });

  it('rejects malformed, unknown, and incomplete event writes', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const missing = '00000000-0000-7000-8000-000000000099';

    await request(app.getHttpServer())
      .get('/api/v1/events/not-a-uuid')
      .set(bearer(admin.token))
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/v1/events/${missing}`)
      .set(bearer(admin.token))
      .expect(404);
    await request(app.getHttpServer())
      .put(`/api/v1/events/${missing}`)
      .set(bearer(admin.token))
      .send(eventBody())
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/events/${missing}`)
      .set(bearer(admin.token))
      .expect(404);

    const rejected = [
      eventBody({ title: '' }),
      eventBody({ title: 'x'.repeat(201) }),
      eventBody({ venue: '' }),
      eventBody({ description: 'x'.repeat(5001) }),
      eventBody({ ticketPrice: -1 }),
      eventBody({ ticketPrice: 1.999 }),
      eventBody({ totalTickets: 0 }),
      eventBody({ startsAt: 'not-a-date' }),
      eventBody({ startsAt: new Date(Date.now() - 60_000).toISOString() }),
    ];
    for (const body of rejected) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/events')
        .set(bearer(admin.token))
        .send(body)
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('trims text, stores a free ticket, and keeps a started event readable by id', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const title = `test-event-${crypto.randomUUID()}`;
    const created = await createEvent(
      app,
      admin.token,
      eventBody({
        title: `  ${title}  `,
        venue: '  Kadikoy  ',
        description: '',
        ticketPrice: 0,
      }),
    );

    expect(created.title).toBe(title);
    expect(created.ticketPrice).toBe('0.00');

    await app.get(PrismaService).event.update({
      where: { id: created.id },
      data: { startsAt: new Date('2020-01-01T00:00:00.000Z') },
    });
    const readable = await request(app.getHttpServer())
      .get(`/api/v1/events/${created.id}`)
      .set(bearer(customer.token))
      .expect(200);
    expect(readable.body.title).toBe(title);
    expect(readable.body.venue).toBe('Kadikoy');
  });

  it('refuses a capacity below current reservations and grows the rest', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ totalTickets: 5 }),
    );
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set(bearer(customer.token))
      .send({ eventId: event.id, quantity: 2 })
      .expect(201);

    const tooSmall = await request(app.getHttpServer())
      .put(`/api/v1/events/${event.id}`)
      .set(bearer(admin.token))
      .send(eventBody({ title: event.title, totalTickets: 1 }))
      .expect(409);
    expect(tooSmall.body.code).toBe('CAPACITY_BELOW_RESERVED');

    const exact = await request(app.getHttpServer())
      .put(`/api/v1/events/${event.id}`)
      .set(bearer(admin.token))
      .send(eventBody({ title: event.title, totalTickets: 2 }))
      .expect(200);
    expect(exact.body.availableTickets).toBe(0);
    expect(exact.body.totalTickets).toBe(2);

    const grown = await request(app.getHttpServer())
      .put(`/api/v1/events/${event.id}`)
      .set(bearer(admin.token))
      .send(eventBody({ title: event.title, totalTickets: 6 }))
      .expect(200);
    expect(grown.body.availableTickets).toBe(4);
    expect(grown.body.totalTickets).toBe(6);
  });

  it('rejects an update while cancellation is in progress', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const event = await createEvent(app, admin.token, eventBody());
    await app.get(PrismaService).event.update({
      where: { id: event.id },
      data: { salesClosedAt: new Date() },
    });

    const blocked = await request(app.getHttpServer())
      .put(`/api/v1/events/${event.id}`)
      .set(bearer(admin.token))
      .send(eventBody({ title: event.title }))
      .expect(409);
    expect(blocked.body.code).toBe('EVENT_CANCELLING');

    const adminView = await request(app.getHttpServer())
      .get(`/api/v1/admin/events/${event.id}`)
      .set(bearer(admin.token))
      .expect(200);
    expect(adminView.body.status).toBe('CANCELLING');
    await request(app.getHttpServer())
      .get(`/api/v1/events/${event.id}`)
      .set(bearer(admin.token))
      .expect(404);

    await app.get(EventCancellationService).processOne(event.id);
  });

  it('filters the admin catalog and rejects an inverted date window', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const onSale = await createEvent(app, admin.token, eventBody());
    const past = await createEvent(app, admin.token, eventBody());
    await app.get(PrismaService).event.update({
      where: { id: past.id },
      data: { startsAt: new Date('2020-06-01T00:00:00.000Z') },
    });
    const removed = await createEvent(app, admin.token, eventBody());
    await request(app.getHttpServer())
      .delete(`/api/v1/events/${removed.id}`)
      .set(bearer(admin.token))
      .expect(202);
    await app.get(EventCancellationService).processOne(removed.id);

    const pastPage = await request(app.getHttpServer())
      .get('/api/v1/admin/events')
      .query({ status: 'past', limit: 100 })
      .set(bearer(admin.token))
      .expect(200);
    const pastIds = pastPage.body.items.map((item: { id: string }) => item.id);
    expect(pastIds).toContain(past.id);
    expect(pastIds).not.toContain(onSale.id);

    const onSalePage = await request(app.getHttpServer())
      .get('/api/v1/admin/events')
      .query({ status: 'on_sale', limit: 100 })
      .set(bearer(admin.token))
      .expect(200);
    const onSaleIds = onSalePage.body.items.map(
      (item: { id: string }) => item.id,
    );
    expect(onSaleIds).toContain(onSale.id);
    expect(onSaleIds).not.toContain(past.id);

    const deletedPage = await request(app.getHttpServer())
      .get('/api/v1/admin/events')
      .query({ status: 'deleted', limit: 100 })
      .set(bearer(admin.token))
      .expect(200);
    expect(
      deletedPage.body.items.map((item: { id: string }) => item.id),
    ).toContain(removed.id);

    await request(app.getHttpServer())
      .get('/api/v1/admin/events')
      .query({ status: 'nope' })
      .set(bearer(admin.token))
      .expect(400);
    const inverted = await request(app.getHttpServer())
      .get('/api/v1/events')
      .query({
        from: '2027-02-01T00:00:00.000Z',
        to: '2027-01-01T00:00:00.000Z',
      })
      .set(bearer(customer.token))
      .expect(400);
    expect(inverted.body.code).toBe('INVALID_RANGE');
    await request(app.getHttpServer())
      .get('/api/v1/events')
      .query({ limit: 0 })
      .set(bearer(customer.token))
      .expect(400);
  });

  it('finds an event by a short title fragment and by a quoted word', async () => {
    const admin = await loginAs(app, Role.ADMIN);
    const customer = await loginAs(app, Role.CUSTOMER);
    const token = crypto.randomUUID().replaceAll('-', '');
    const event = await createEvent(
      app,
      admin.token,
      eventBody({ title: `test-event-qx${token}` }),
    );

    const shortQuery = await request(app.getHttpServer())
      .get('/api/v1/events')
      .query({ q: 'qx', limit: 100 })
      .set(bearer(customer.token))
      .expect(200);
    expect(
      shortQuery.body.items.map((item: { id: string }) => item.id),
    ).toContain(event.id);

    const fullText = await request(app.getHttpServer())
      .get('/api/v1/events')
      .query({ q: `qx${token}(`, limit: 100 })
      .set(bearer(customer.token))
      .expect(200);
    expect(
      fullText.body.items.map((item: { id: string }) => item.id),
    ).toContain(event.id);
  });
});
