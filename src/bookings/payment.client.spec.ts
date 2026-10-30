import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PaymentClient } from './payment.client.js';

describe('PaymentClient', () => {
  let server: Server;
  let client: PaymentClient;

  beforeEach(async () => {
    server = createServer((request, response) => {
      const paid = request.url === '/paid';
      response.writeHead(paid ? 200 : 402, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify({ paid }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    client = new PaymentClient({
      get: () => `http://127.0.0.1:${port}/paid`,
    } as ConfigService);
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('accepts a payment the mock marks as paid', async () => {
    await expect(
      client.confirm({ bookingId: 'booking-id', amount: '25.00' }),
    ).resolves.toBe(true);
  });

  it('reports a declined payment without throwing', async () => {
    const { port } = server.address() as AddressInfo;
    client = new PaymentClient({
      get: () => `http://127.0.0.1:${port}/declined`,
    } as ConfigService);

    await expect(
      client.confirm({ bookingId: 'booking-id', amount: '25.00' }),
    ).resolves.toBe(false);
  });

  it('fails when the payment service returns a body that is not JSON', async () => {
    const { port } = server.address() as AddressInfo;
    server.removeAllListeners('request');
    server.on('request', (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('not-json');
    });
    client = new PaymentClient({
      get: () => `http://127.0.0.1:${port}/paid`,
    } as ConfigService);

    await expect(
      client.confirm({ bookingId: 'booking-id', amount: '25.00' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('fails when the payment service cannot be reached', async () => {
    client = new PaymentClient({
      get: () => 'http://127.0.0.1:1/payments',
    } as ConfigService);

    await expect(
      client.confirm({ bookingId: 'booking-id', amount: '25.00' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
