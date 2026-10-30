import {
  ConflictException,
  type INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
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

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
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
