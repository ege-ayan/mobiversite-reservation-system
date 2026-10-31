import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mariadb from 'mariadb';

import type { EnvironmentVariables } from '@/config/env.validation.js';
import { mysqlConnectionConfig } from '@/prisma/mysql-config.js';

export const SWEEP_LOCK_NAME = 'mobiversite_booking_expiry';
export const PAYMENT_LOCK_NAME = 'mobiversite_payment_reconcile';
export const CANCELLATION_LOCK_NAME = 'mobiversite_event_cancellation';

@Injectable()
export class SweepLock {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async tryWithLock<T>(
    name: string,
    work: () => Promise<T>,
    waitSeconds = 0,
  ): Promise<T | null> {
    const connection = await mariadb.createConnection(
      mysqlConnectionConfig(this.config.get('DATABASE_URL', { infer: true })),
    );
    try {
      const rows = await connection.query<Array<{ acquired: unknown }>>(
        'SELECT GET_LOCK(?, ?) AS acquired',
        [name, waitSeconds],
      );
      if (!lockAcquired(rows[0]?.acquired)) {
        return null;
      }
      try {
        return await work();
      } finally {
        await connection.query('SELECT RELEASE_LOCK(?)', [name]);
      }
    } finally {
      await connection.end();
    }
  }
}

function lockAcquired(value: unknown): boolean {
  return value === 1 || value === 1n || value === '1';
}
