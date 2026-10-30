import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';

export interface PaymentConfirmation {
  bookingId: string;
  amount: string;
}

@Injectable()
export class PaymentClient {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async confirm(payment: PaymentConfirmation): Promise<boolean> {
    let response: Response;
    try {
      response = await fetch(
        this.config.get('PAYMENT_SERVICE_URL', { infer: true }),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payment),
          signal: AbortSignal.timeout(5_000),
        },
      );
    } catch {
      throw new BadGatewayException('Payment service is unavailable');
    }

    if (!response.ok) {
      return false;
    }

    try {
      const body = (await response.json()) as { paid?: unknown };
      return body.paid === true;
    } catch {
      throw new BadGatewayException('Payment service is unavailable');
    }
  }
}
