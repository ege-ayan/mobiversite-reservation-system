import { Prisma } from '@/generated/prisma/client.js';

import { WRITE_TRANSACTION } from './transaction.js';

type WriteClient = {
  $transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
};

export function isDatabaseBusy(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2028' || error.code === 'P2034')
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : '';
  return /deadlock|lock wait timeout/i.test(message);
}

export async function withDatabaseRetry<T>(
  work: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      last = error;
      if (!isDatabaseBusy(error) || attempt === attempts) {
        throw error;
      }
      await delay(25 * attempt);
    }
  }
  throw last;
}

export function runWrite<T>(
  prisma: WriteClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return withDatabaseRetry(() => prisma.$transaction(work, WRITE_TRANSACTION));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
