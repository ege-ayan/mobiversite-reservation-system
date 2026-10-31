import { Inject, Injectable } from '@nestjs/common';

import { amountOf } from '@/bookings/booking-amount.js';
import { badGateway } from '@/common/errors/app.exception.js';
import { ErrorCode } from '@/common/errors/error-code.js';
import { PaymentState, Prisma } from '@/generated/prisma/client.js';
import { PrismaService } from '@/prisma/prisma.service.js';

import { PAYMENT_GATEWAY, type PaymentGateway } from './payment.client.js';

@Injectable()
export class RefundService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly payments: PaymentGateway,
  ) {}

  async refundBooking(booking: {
    id: string;
    ticketPrice: Prisma.Decimal;
    quantity: number;
  }): Promise<void> {
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: {
        bookingId: booking.id,
        state: {
          in: [
            PaymentState.APPLIED,
            PaymentState.REFUND_DUE,
            PaymentState.PENDING,
            PaymentState.REFUNDED,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (attempt?.state === PaymentState.REFUNDED) {
      return;
    }
    if (attempt && attempt.state !== PaymentState.REFUND_DUE) {
      await this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { state: PaymentState.REFUND_DUE },
      });
    }
    const refunded = await this.payments.refund({
      bookingId: booking.id,
      amount: amountOf(booking),
      idempotencyKey: attempt?.idempotencyKey ?? booking.id,
    });
    if (!refunded) {
      throw badGateway('Refund was not confirmed', ErrorCode.REFUND_FAILED);
    }
  }
}
