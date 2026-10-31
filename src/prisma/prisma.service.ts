import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

import type { EnvironmentVariables } from '@/config/env.validation.js';
import { PrismaClient } from '@/generated/prisma/client.js';

import { mysqlConnectionConfig } from './mysql-config.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const poolSize = config.get('DATABASE_POOL_SIZE', { infer: true });
    super({
      adapter: new PrismaMariaDb(
        mysqlConnectionConfig(config.get('DATABASE_URL', { infer: true }), {
          pooled: true,
          connectionLimit: typeof poolSize === 'number' ? poolSize : undefined,
        }),
      ),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
