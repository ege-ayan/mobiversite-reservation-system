import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mariadb from 'mariadb';
import type { EnvironmentVariables } from '../config/env.validation.js';

export const SWEEP_LOCK_NAME = 'mobiversite_booking_expiry';

@Injectable()
export class SweepLock {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async tryWithLock<T>(
    name: string,
    work: () => Promise<T>,
  ): Promise<T | null> {
    const connection = await mariadb.createConnection(
      connectionOptions(this.config.get('DATABASE_URL', { infer: true })),
    );
    try {
      const rows = await connection.query<Array<{ acquired: unknown }>>(
        'SELECT GET_LOCK(?, 0) AS acquired',
        [name],
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

function connectionOptions(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
  };
}

function lockAcquired(value: unknown): boolean {
  return value === 1 || value === 1n || value === '1';
}
