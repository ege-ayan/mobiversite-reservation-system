import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';

import { AppModule } from '@/app.module.js';
import { configureApp } from '@/config/app.config.js';
import { Role } from '@/generated/prisma/client.js';
import { PAYMENT_GATEWAY } from '@/payment/payment.client.js';
import { PrismaService } from '@/prisma/prisma.service.js';

export type PaymentDoubles = {
  confirm: ReturnType<typeof vi.fn>;
  refund: ReturnType<typeof vi.fn>;
  lookup: ReturnType<typeof vi.fn>;
};

export async function bootReservationApp(): Promise<{
  app: INestApplication<App>;
  payments: PaymentDoubles;
}> {
  const payments: PaymentDoubles = {
    confirm: vi.fn(),
    refund: vi.fn(),
    lookup: vi.fn(),
  };
  resetPayments(payments);
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PAYMENT_GATEWAY)
    .useValue(payments)
    .compile();

  const app = moduleFixture.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();
  return { app, payments };
}

export function resetPayments(payments: PaymentDoubles) {
  payments.confirm.mockReset();
  payments.confirm.mockResolvedValue(true);
  payments.refund.mockReset();
  payments.refund.mockResolvedValue(true);
  payments.lookup.mockReset();
  payments.lookup.mockResolvedValue('unknown');
}

export async function shutdownReservationApp(app: INestApplication<App>) {
  const prisma = app.get(PrismaService);
  await prisma.paymentAttempt.deleteMany({
    where: { booking: { event: { title: { startsWith: 'test-event-' } } } },
  });
  await prisma.bookingEvent.deleteMany({
    where: { booking: { event: { title: { startsWith: 'test-event-' } } } },
  });
  await prisma.booking.deleteMany({
    where: { event: { title: { startsWith: 'test-event-' } } },
  });
  await prisma.event.deleteMany({
    where: { title: { startsWith: 'test-event-' } },
  });
  await prisma.refreshToken.deleteMany({
    where: { user: { email: { endsWith: '@example.test' } } },
  });
  await prisma.user.deleteMany({
    where: { email: { endsWith: '@example.test' } },
  });
  await app.close();
}

export function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function eventBody(overrides: Record<string, unknown> = {}) {
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

export async function createEvent(
  app: INestApplication<App>,
  token: string,
  body: ReturnType<typeof eventBody>,
) {
  const response = await request(app.getHttpServer())
    .post('/api/v1/events')
    .set(bearer(token))
    .send(body)
    .expect(201);
  return response.body as {
    id: string;
    title: string;
    ticketPrice: string;
    availableTickets: number;
    totalTickets: number;
  };
}

export async function clearCatalog(app: INestApplication<App>) {
  const prisma = app.get(PrismaService);
  await prisma.paymentAttempt.deleteMany({
    where: { booking: { event: { title: { startsWith: 'test-event-' } } } },
  });
  await prisma.bookingEvent.deleteMany({
    where: { booking: { event: { title: { startsWith: 'test-event-' } } } },
  });
  await prisma.booking.deleteMany({
    where: { event: { title: { startsWith: 'test-event-' } } },
  });
  await prisma.event.deleteMany({
    where: { title: { startsWith: 'test-event-' } },
  });
}

export async function expire(app: INestApplication<App>, bookingId: string) {
  await app.get(PrismaService).booking.update({
    where: { id: bookingId },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  });
}

export async function loginAs(app: INestApplication<App>, role: Role) {
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
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return { token: response.body.accessToken as string, email };
}
