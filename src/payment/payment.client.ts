import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';

export interface PaymentConfirmation {
  bookingId: string;
  amount: string;
}

export interface PaymentGateway {
  confirm(payment: PaymentConfirmation): Promise<boolean>;
  refund(payment: PaymentConfirmation): Promise<boolean>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

@Injectable()
export class PaymentClient implements PaymentGateway {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  confirm(payment: PaymentConfirmation): Promise<boolean> {
    return this.post(
      this.config.get('PAYMENT_SERVICE_URL', { infer: true }),
      payment,
      'paid',
    );
  }

  refund(payment: PaymentConfirmation): Promise<boolean> {
    const url = new URL(
      this.config.get('PAYMENT_SERVICE_URL', { infer: true }),
    );
    url.pathname = url.pathname.replace(/[^/]*$/, 'refunds');
    return this.post(url.toString(), payment, 'refunded');
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
          'idempotency-key': payment.bookingId,
        },
        body: JSON.stringify(payment),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
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
