import {
  type INestApplication,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

describe('HealthController', () => {
  let app: INestApplication<App>;
  const healthService = { check: vi.fn() };

  beforeEach(async () => {
    healthService.check.mockReset();

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: healthService }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(() => app.close());

  it('returns the database check', async () => {
    healthService.check.mockResolvedValue({ status: 'ok' });

    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns 503 when the database is unavailable', async () => {
    healthService.check.mockRejectedValue(
      new ServiceUnavailableException('Database is unavailable'),
    );

    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(503);

    expect(response.body.message).toBe('Database is unavailable');
  });
});
