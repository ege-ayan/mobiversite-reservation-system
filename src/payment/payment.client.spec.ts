import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '@/config/env.validation.js';

import { PaymentClient } from './payment.client.js';

describe('PaymentClient', () => {
  let server: Server;
  let client: PaymentClient;
  let lastRequest: {
    url?: string;
    idempotencyKey?: string | string[];
    mockDecision?: string | string[];
  };

  beforeEach(async () => {
    lastRequest = {};
    server = createServer((request, response) => {
      lastRequest = {
        url: request.url,
        idempotencyKey: request.headers['idempotency-key'],
        mockDecision: request.headers['x-mock-payment'],
      };
      request.resume();
      const url = request.url ?? '';
      if (request.method === 'GET' && url.startsWith('/payments/')) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ paid: false }));
        return;
      }
      if (url === '/refunds') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ refunded: true }));
        return;
      }
      const declined = request.headers['x-mock-payment'] === 'decline';
      response.writeHead(declined ? 402 : 200, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify({ paid: !declined }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    client = clientFor(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('accepts a payment the mock marks as paid', async () => {
    await expect(
      client.confirm({
        bookingId: 'booking-id',
        amount: '25.00',
        idempotencyKey: 'booking-id',
      }),
    ).resolves.toBe(true);
    expect(lastRequest.url).toBe('/payments');
    expect(lastRequest.idempotencyKey).toBe('booking-id');
  });

  it('accepts a configured URL that already ends in /payments', async () => {
    const { port } = server.address() as AddressInfo;
    client = new PaymentClient(config(`http://127.0.0.1:${port}/payments`));

    await expect(
      client.confirm({
        bookingId: 'booking-id',
        amount: '25.00',
        idempotencyKey: 'booking-id',
      }),
    ).resolves.toBe(true);
    expect(lastRequest.url).toBe('/payments');
  });

  it('asks the refund endpoint to return a payment', async () => {
    await expect(
      client.refund({
        bookingId: 'booking-id',
        amount: '25.00',
        idempotencyKey: 'booking-id',
      }),
    ).resolves.toBe(true);
    expect(lastRequest.url).toBe('/refunds');
    expect(lastRequest.idempotencyKey).toBe('booking-id');
  });

  it('forwards a simulated decline and reports it without throwing', async () => {
    await expect(
      client.confirm({
        bookingId: 'booking-id',
        amount: '25.00',
        idempotencyKey: 'booking-id',
        decision: 'decline',
      }),
    ).resolves.toBe(false);
    expect(lastRequest.mockDecision).toBe('decline');
  });

  it('treats a provider 500 as unavailable instead of a decline', async () => {
    replaceHandler(server, (_request, response) => {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ paid: false }));
    });

    await expect(
      client.confirm({
        bookingId: 'booking-id',
        amount: '25.00',
        idempotencyKey: 'booking-id',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('reports an unknown payment lookup', async () => {
    await expect(client.lookup('missing')).resolves.toBe('unknown');
    expect(lastRequest.url).toBe('/payments/missing');
  });

  it('fails when the payment service returns a body that is not JSON', async () => {
    replaceHandler(server, (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('not-json');
    });

    await expect(
      client.confirm({
        bookingId: 'booking-id',
        amount: '25.00',
        idempotencyKey: 'booking-id',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('fails when the payment service cannot be reached', async () => {
    client = new PaymentClient(config('http://127.0.0.1:1'));

    await expect(
      client.confirm({
        bookingId: 'booking-id',
        amount: '25.00',
        idempotencyKey: 'booking-id',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});

function clientFor(server: Server) {
  const { port } = server.address() as AddressInfo;
  return new PaymentClient(config(`http://127.0.0.1:${port}`));
}

function config(url: string) {
  return {
    get: () => url,
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

function replaceHandler(
  server: Server,
  listener: (
    request: IncomingMessage,
    response: import('node:http').ServerResponse,
  ) => void,
) {
  server.removeAllListeners('request');
  server.on('request', listener);
}
