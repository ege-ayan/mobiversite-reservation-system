import {
  ConflictException,
  UnauthorizedException,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

const password = 'correct horse battery';

const user = {
  id: 'user-id',
  email: 'ada@example.com',
  role: 'CUSTOMER' as const,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('AuthController', () => {
  let app: INestApplication<App>;
  const authService = {
    login: vi.fn(),
    register: vi.fn(),
  };

  beforeEach(async () => {
    authService.login.mockReset();
    authService.register.mockReset();
    app = await createApp(100, authService);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /auth/login', () => {
    const body = { email: 'ada@example.com', password };

    it('returns 200 and the access token from the service', async () => {
      authService.login.mockResolvedValue({
        accessToken: 'signed-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        user,
      });

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send(body)
        .expect(200);

      expect(authService.login).toHaveBeenCalledWith(body);
      expect(response.body).toEqual({
        accessToken: 'signed-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        user: {
          ...user,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        },
      });
    });

    it('returns 401 when the service rejects the credentials', async () => {
      authService.login.mockRejectedValue(
        new UnauthorizedException('Invalid email or password'),
      );

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send(body)
        .expect(401);

      expect(response.body.message).toBe('Invalid email or password');
    });
  });

  describe('POST /auth/register', () => {
    const body = { email: 'ada@example.com', password };

    it('returns 201 and the user from the service', async () => {
      authService.register.mockResolvedValue(user);

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(body)
        .expect(201);

      expect(authService.register).toHaveBeenCalledWith(body);
      expect(response.body).toEqual({
        ...user,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      });
    });

    it('returns 409 when the service reports a duplicate email', async () => {
      authService.register.mockRejectedValue(
        new ConflictException('Email already registered'),
      );

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(body)
        .expect(409);

      expect(response.body.message).toBe('Email already registered');
    });
  });
});

describe('AuthController rate limit', () => {
  let app: INestApplication<App>;
  const authService = {
    login: vi.fn(),
    register: vi.fn(),
  };

  beforeEach(async () => {
    authService.login.mockResolvedValue({ accessToken: 'signed-token' });
    authService.register.mockResolvedValue({ id: 'user-id' });
    app = await createApp(2, authService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 429 after the login limit', async () => {
    const body = { email: 'ada@example.com', password };

    await request(app.getHttpServer())
      .post('/auth/login')
      .send(body)
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send(body)
      .expect(200);

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send(body)
      .expect(429);

    expect(response.body).toEqual({
      message: 'Too many requests',
      error: 'Too Many Requests',
      statusCode: 429,
      code: 'RATE_LIMITED',
    });
    expect(authService.login).toHaveBeenCalledTimes(2);
  });

  it('returns 429 after the register limit', async () => {
    const body = { email: 'ada@example.com', password };

    await request(app.getHttpServer())
      .post('/auth/register')
      .send(body)
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(body)
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send(body)
      .expect(429);

    expect(response.body.message).toBe('Too many requests');
    expect(authService.register).toHaveBeenCalledTimes(2);
  });
});

async function createApp(
  limit: number,
  authService: {
    login: ReturnType<typeof vi.fn>;
    register: ReturnType<typeof vi.fn>;
  },
) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot({
        throttlers: [{ ttl: 60_000, limit }],
      }),
    ],
    controllers: [AuthController],
    providers: [{ provide: AuthService, useValue: authService }],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}
