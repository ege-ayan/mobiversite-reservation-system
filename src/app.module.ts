import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { environmentSchema } from './config/env.validation.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    PrismaModule,
    AuthModule,
  ],
})
export class AppModule {}
