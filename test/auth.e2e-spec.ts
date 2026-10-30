import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  const password = 'correct horse battery';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.get(PrismaService).user.deleteMany({
      where: { email: { endsWith: '@example.test' } },
    });
    await app.close();
  });

  it('registers a customer and hides the password hash', async () => {
    const email = uniqueEmail();

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: ` ${email.toUpperCase()} `, password })
      .expect(201);

    expect(response.body).toMatchObject({
      email,
      role: 'CUSTOMER',
    });
    expect(response.body.id).toEqual(expect.any(String));
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain(password);
  });

  it('rejects a duplicate email regardless of case', async () => {
    const email = uniqueEmail();
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    const duplicate = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: email.toUpperCase(), password })
      .expect(409);

    expect(duplicate.body.message).toBe('Email already registered');
  });

  it('keeps a single user when the same email is registered at once', async () => {
    const email = uniqueEmail();
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        request(app.getHttpServer())
          .post('/auth/register')
          .send({
            email: index % 2 === 0 ? email : ` ${email.toUpperCase()} `,
            password,
          }),
      ),
    );

    const created = attempts.filter((response) => response.status === 201);
    const conflicts = attempts.filter((response) => response.status === 409);

    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(attempts.length - 1);
    expect(created[0]?.body.email).toBe(email);
    for (const conflict of conflicts) {
      expect(conflict.body.message).toBe('Email already registered');
    }

    await expect(
      app.get(PrismaService).user.count({ where: { email } }),
    ).resolves.toBe(1);
  });

  it('rejects invalid registration bodies', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'not-an-email', password })
      .expect(400);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: uniqueEmail(), password: 'short' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: uniqueEmail(), password, role: 'ADMIN' })
      .expect(400);
  });

  it('logs in and returns a JWT that matches the user', async () => {
    const email = uniqueEmail();
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: email.toUpperCase(), password })
      .expect(200);

    expect(response.body.tokenType).toBe('Bearer');
    expect(response.body.expiresIn).toBe(86_400);
    expect(response.body.user).toMatchObject({
      id: registered.body.id,
      email,
      role: 'CUSTOMER',
    });
    expect(response.body).not.toHaveProperty('passwordHash');

    const payload = await app.get(JwtService).verifyAsync<{
      sub: string;
      email: string;
      role: string;
      exp: number;
      iat: number;
    }>(response.body.accessToken);

    expect(payload.sub).toBe(registered.body.id);
    expect(payload.email).toBe(email);
    expect(payload.role).toBe('CUSTOMER');
    expect(payload.exp - payload.iat).toBe(86_400);
  });

  it('rejects a wrong password and an unknown email the same way', async () => {
    const email = uniqueEmail();
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    const wrongPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'not the password' })
      .expect(401);

    const unknownEmail = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: uniqueEmail(), password })
      .expect(401);

    expect(wrongPassword.body.message).toBe('Invalid email or password');
    expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
  });

  it('accepts simultaneous logins for the same account', async () => {
    const email = uniqueEmail();
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    const logins = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password }),
      ),
    );

    expect(logins.map((response) => response.status)).toEqual([
      200, 200, 200, 200, 200,
    ]);
    for (const login of logins) {
      expect(login.body.user.id).toBe(registered.body.id);
      expect(login.body.accessToken).toEqual(expect.any(String));
    }
  });

  it('rejects simultaneous logins for an unknown email', async () => {
    const email = uniqueEmail();
    const logins = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password }),
      ),
    );

    for (const login of logins) {
      expect(login.status).toBe(401);
      expect(login.body.message).toBe('Invalid email or password');
    }
  });

  it('documents the auth operations in the OpenAPI spec', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    const login = response.body.paths['/auth/login'].post;
    const register = response.body.paths['/auth/register'].post;
    const schemas = response.body.components.schemas;

    expect(response.body.paths['/']).toBeUndefined();
    expect(response.body.servers).toEqual([{ url: 'http://localhost:3000' }]);
    expect(response.body.tags).toEqual([
      { name: 'Auth', description: 'Customer registration and login' },
    ]);
    expect(login.tags).toEqual(['Auth']);
    expect(register.tags).toEqual(['Auth']);
    expect(login.responses['200'].description).toBe(
      'JWT access token for the authenticated user',
    );
    expect(login.responses['401'].content['application/json'].example).toEqual({
      message: 'Invalid email or password',
      error: 'Unauthorized',
      statusCode: 401,
    });
    expect(register.responses['201'].description).toBe(
      'Created customer account',
    );
    expect(
      register.responses['409'].content['application/json'].example,
    ).toEqual({
      message: 'Email already registered',
      error: 'Conflict',
      statusCode: 409,
    });
    expect(schemas.LoginRequest.properties.email.format).toBe('email');
    expect(schemas.RegisterRequest.properties.email.format).toBe('email');
    expect(schemas.RegisterRequest.properties.password.minLength).toBe(12);
    expect(schemas.RegisterRequest.properties.password.maxLength).toBe(128);
    expect(schemas.LoginResponse.properties.accessToken.example).toEqual(
      expect.any(String),
    );
    expect(schemas.ValidationErrorResponse.properties.message.type).toBe(
      'array',
    );
    expect(schemas.HttpErrorResponse.properties.statusCode).toBeDefined();
    expect(response.body.components.securitySchemes.bearer).toBeDefined();

    await request(app.getHttpServer()).get('/docs').expect(200);
  });
});

function uniqueEmail() {
  return `ada-${crypto.randomUUID()}@example.test`;
}
