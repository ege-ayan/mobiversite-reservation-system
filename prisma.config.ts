import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

const databaseUrl =
  process.env.DATABASE_URL ??
  'mysql://mobiversite:mobiversite@127.0.0.1:3306/mobiversite';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.mjs',
  },
  datasource: {
    url: process.env.DATABASE_URL ? env('DATABASE_URL') : databaseUrl,
  },
});
