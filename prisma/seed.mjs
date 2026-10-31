import { existsSync, readFileSync } from 'node:fs';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import bcrypt from 'bcryptjs';

loadEnvFile();

function loadEnvFile() {
  const path = new URL('../.env', import.meta.url);
  if (!existsSync(path)) {
    return;
  }
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const clientPath = new URL(
  '../dist/generated/prisma/client.js',
  import.meta.url,
);
if (!existsSync(clientPath)) {
  console.error('Build the project before seeding: npm run build');
  process.exit(1);
}

const { PrismaClient } = await import(clientPath.href);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const email = (process.env.ADMIN_EMAIL ?? 'admin@mobiversite.local')
  .trim()
  .toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? 'change-me-admin';
const eventId = '00000000-0000-7000-8000-000000000002';

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(databaseUrl),
});

try {
  await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN' },
    create: {
      id: '00000000-0000-7000-8000-000000000001',
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'ADMIN',
    },
  });

  await prisma.event.upsert({
    where: { id: eventId },
    update: {},
    create: {
      id: eventId,
      title: 'Mobiversite Live',
      description: 'An evening of talks and music.',
      venue: 'Kadikoy',
      startsAt: new Date('2027-06-01T18:00:00.000Z'),
      ticketPrice: '25.00',
      totalTickets: 100,
      availableTickets: 100,
    },
  });
} finally {
  await prisma.$disconnect();
}
