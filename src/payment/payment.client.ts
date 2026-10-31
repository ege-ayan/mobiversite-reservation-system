import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';

export const MOCK_PAYMENT_DECISIONS = [
  'decline',
  'error',
  'timeout',
  'slow',
  'error-after-charge',
] as const;

export type MockPaymentDecision = (typeof MOCK_PAYMENT_DECISIONS)[number];

export interface PaymentConfirmation {
  bookingId: string;
  amount: string;
  idempotencyKey: string;
  decision?: MockPaymentDecision;
}

export type PaymentLookup = 'paid' | 'declined' | 'unknown';

export interface PaymentGateway {
  confirm(payment: PaymentConfirmation): Promise<boolean>;
  refund(payment: PaymentConfirmation): Promise<boolean>;
  lookup(idempotencyKey: string): Promise<PaymentLookup>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export function paymentEndpoints(configured: string) {
  const url = new URL(configured);
  let path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/payments')) {
    path = path.slice(0, -'/payments'.length);
  }
  const payments = new URL(url);
  payments.pathname = `${path}/payments`;
  payments.search = '';
  payments.hash = '';
  const refunds = new URL(payments);
  refunds.pathname = `${path}/refunds`;
  return {
    payments: payments.toString(),
    refunds: refunds.toString(),
    lookup(idempotencyKey: string) {
      const lookup = new URL(payments);
      lookup.pathname = `${path}/payments/${encodeURIComponent(idempotencyKey)}`;
      return lookup.toString();
    },
  };
}

export function mockPaymentDecision(
  header: string | string[] | undefined,
  nodeEnv: string,
): MockPaymentDecision | undefined {
  if (nodeEnv === 'production') {
    return undefined;
  }
  const value = Array.isArray(header)
    ? header.length === 1
      ? header[0]
      : undefined
    : header;
  if (
    value === 'decline' ||
    value === 'error' ||
    value === 'timeout' ||
    value === 'slow' ||
    value === 'error-after-charge'
  ) {
    return value;
  }
  return undefined;
}

@Injectable()
export class PaymentClient implements PaymentGateway {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  confirm(payment: PaymentConfirmation): Promise<boolean> {
    const endpoints = this.endpoints();
    return this.post(endpoints.payments, payment, 'paid');
  }

  refund(payment: PaymentConfirmation): Promise<boolean> {
    return this.post(this.endpoints().refunds, payment, 'refunded');
  }

  async lookup(idempotencyKey: string): Promise<PaymentLookup> {
    let response: Response;
    try {
      response = await fetch(this.endpoints().lookup(idempotencyKey), {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new BadGatewayException('Payment service is unavailable');
    }
    if (response.status === 404) {
      return 'unknown';
    }
    if (!response.ok) {
      throw new BadGatewayException('Payment service is unavailable');
    }
    try {
      const body = (await response.json()) as { paid?: unknown };
      if (body.paid === true) {
        return 'paid';
      }
      if (body.paid === false) {
        return 'declined';
      }
    } catch {
      throw new BadGatewayException('Payment service is unavailable');
    }
    throw new BadGatewayException('Payment service is unavailable');
  }

  private endpoints() {
    return paymentEndpoints(
      this.config.get('PAYMENT_SERVICE_URL', { infer: true }),
    );
  }

  private async post(
    url: string,
    payment: PaymentConfirmation,
    flag: 'paid' | 'refunded',
  ): Promise<boolean> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': payment.idempotencyKey,
          ...(payment.decision ? { 'x-mock-payment': payment.decision } : {}),
        },
        body: JSON.stringify({
          bookingId: payment.bookingId,
          amount: payment.amount,
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new BadGatewayException('Payment service is unavailable');
    }

    if (response.status >= 500) {
      throw new BadGatewayException('Payment service is unavailable');
    }
    if (!response.ok) {
      return false;
    }

    try {
      const body = (await response.json()) as {
        paid?: unknown;
        refunded?: unknown;
      };
      return body[flag] === true;
    } catch {
      throw new BadGatewayException('Payment service is unavailable');
    }
  }
}
