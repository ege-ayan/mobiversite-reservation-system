import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  badGateway,
  conflict,
  notFound,
} from '../common/errors/app.exception.js';
import { PAYMENT_LOCK_NAME, SweepLock } from '../common/locking/mysql-lock.js';
import { BookingStatus, PaymentState } from '../generated/prisma/client.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { runWrite } from '../prisma/retry.js';
import {
  PAYMENT_GATEWAY,
  type MockPaymentDecision,
  type PaymentGateway,
} from '../payment/payment.client.js';
import { amountOf } from './booking-amount.js';
import { applyPaidRefund } from './booking-lifecycle.js';
import { recordBookingTransition } from './booking-history.js';
import { BookingQueryService } from './booking-query.service.js';
import {
  toBookingResponse,
  type BookingWithEvent,
} from './booking-response.mapper.js';
import type { BookingResponse } from './dto/booking-response.js';

const STALE_ATTEMPT_MS = 15_000;
const RECONCILE_BATCH = 50;

type PaymentAttemptRecord = {
  id: string;
  idempotencyKey: string;
  state: PaymentState;
  updatedAt: Date;
};

@Injectable()
export class ChargeService {
  private readonly logger = new Logger(ChargeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly queries: BookingQueryService,
    private readonly sweepLock: SweepLock,
    @Inject(PAYMENT_GATEWAY) private readonly payments: PaymentGateway,
  ) {}

  async pay(
    userId: string,
    bookingId: string,
    options?: { decision?: MockPaymentDecision },
  ): Promise<BookingResponse> {
    const booking = await this.queries.findOwned(userId, bookingId);
    if (booking.status === BookingStatus.PAID) {
      const finished = await this.finishInterruptedRefund(booking);
      return toBookingResponse(finished ?? booking);
    }
    if (
      booking.status !== BookingStatus.HELD ||
      booking.event.deletedAt ||
      booking.event.salesClosedAt
    ) {
      throw conflict(
        'Reservation can no longer be paid',
        ErrorCode.BOOKING_NOT_PAYABLE,
      );
    }
    if (
      booking.expiresAt.getTime() <= Date.now() ||
      booking.event.startsAt.getTime() <= Date.now()
    ) {
      await this.inventory.reclaim(booking.eventId);
      throw conflict('Reservation expired', ErrorCode.BOOKING_EXPIRED);
    }

    const started = await this.beginAttempt(booking);
    if (!started.created) {
      return this.resumeAttempt(booking, started.attempt);
    }

    const paid = await this.payments.confirm({
      bookingId: booking.id,
      amount: amountOf(booking),
      idempotencyKey: started.attempt.idempotencyKey,
      decision: options?.decision,
    });
    if (!paid) {
      await this.prisma.paymentAttempt.update({
        where: { id: started.attempt.id },
        data: { state: PaymentState.DECLINED },
      });
      throw conflict('Payment was not confirmed', ErrorCode.PAYMENT_DECLINED);
    }

    try {
      const confirmed = await this.applyCharge(booking, started.attempt.id);
      return toBookingResponse(confirmed);
    } catch (error) {
      const current = await this.prisma.booking.findUnique({
        where: { id: booking.id },
      });
      if (current?.status === BookingStatus.PAID) {
        return toBookingResponse(
          await this.queries.findOwned(userId, bookingId),
        );
      }
      await this.compensate(booking, started.attempt);
      throw error;
    }
  }

  async reconcilePayments(now = new Date()): Promise<number> {
    const settled = await this.sweepLock.tryWithLock(
      PAYMENT_LOCK_NAME,
      async () => {
        const staleBefore = new Date(now.getTime() - STALE_ATTEMPT_MS);
        const attempts = await this.prisma.paymentAttempt.findMany({
          where: {
            OR: [
              {
                state: { in: [PaymentState.PENDING, PaymentState.REFUND_DUE] },
                updatedAt: { lt: staleBefore },
              },
              {
                state: PaymentState.REFUNDED,
                booking: { status: BookingStatus.PAID },
              },
            ],
          },
          include: { booking: { include: { event: true } } },
          orderBy: { updatedAt: 'asc' },
          take: RECONCILE_BATCH,
        });
        let count = 0;
        for (const attempt of attempts) {
          try {
            await this.finishAttempt(attempt.booking, attempt);
            count += 1;
          } catch (error) {
            this.logger.error(
              `Failed to reconcile payment ${attempt.id}`,
              error instanceof Error ? error.stack : undefined,
            );
          }
        }
        return count;
      },
    );
    return settled ?? 0;
  }

  async applyProviderResult(
    idempotencyKey: string,
    paid: boolean,
  ): Promise<void> {
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { idempotencyKey },
      include: { booking: { include: { event: true } } },
    });
    if (!attempt) {
      throw notFound(
        'Payment attempt not found',
        ErrorCode.PAYMENT_ATTEMPT_NOT_FOUND,
      );
    }
    if (
      attempt.state === PaymentState.APPLIED ||
      attempt.state === PaymentState.REFUNDED ||
      attempt.state === PaymentState.DECLINED
    ) {
      return;
    }
    if (!paid) {
      if (attempt.state === PaymentState.PENDING) {
        await this.prisma.paymentAttempt.update({
          where: { id: attempt.id },
          data: { state: PaymentState.DECLINED },
        });
      }
      return;
    }
    try {
      await this.applyCharge(attempt.booking, attempt.id);
    } catch (error) {
      const current = await this.prisma.booking.findUnique({
        where: { id: attempt.bookingId },
      });
      if (current?.status === BookingStatus.PAID) {
        await this.prisma.paymentAttempt.update({
          where: { id: attempt.id },
          data: { state: PaymentState.APPLIED },
        });
        return;
      }
      await this.compensate(attempt.booking, attempt);
      throw error;
    }
  }

  private async beginAttempt(booking: BookingWithEvent): Promise<{
    created: boolean;
    attempt: PaymentAttemptRecord;
  }> {
    return runWrite(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${booking.id} FOR UPDATE`;
      const open = await tx.paymentAttempt.findFirst({
        where: {
          bookingId: booking.id,
          state: { in: [PaymentState.PENDING, PaymentState.REFUND_DUE] },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (open) {
        return { created: false, attempt: open };
      }
      const count = await tx.paymentAttempt.count({
        where: { bookingId: booking.id },
      });
      const attempt = await tx.paymentAttempt.create({
        data: {
          bookingId: booking.id,
          idempotencyKey:
            count === 0 ? booking.id : `${booking.id}:${count + 1}`,
          amount: amountOf(booking),
          state: PaymentState.PENDING,
        },
      });
      return { created: true, attempt };
    });
  }

  private async resumeAttempt(
    booking: BookingWithEvent,
    attempt: PaymentAttemptRecord,
  ): Promise<BookingResponse> {
    const age = Date.now() - attempt.updatedAt.getTime();
    if (attempt.state === PaymentState.PENDING && age < STALE_ATTEMPT_MS) {
      throw conflict(
        'Payment is already in progress',
        ErrorCode.PAYMENT_IN_PROGRESS,
      );
    }
    if (attempt.state === PaymentState.REFUND_DUE) {
      if (booking.status === BookingStatus.PAID) {
        await this.finishRefundedPayment(booking, attempt);
      } else {
        await this.refundOutstanding(booking, attempt);
      }
      throw conflict(
        'Reservation can no longer be paid',
        ErrorCode.BOOKING_NOT_PAYABLE,
      );
    }
    const finished = await this.finishAttempt(booking, attempt);
    if (!finished) {
      throw conflict('Payment was not confirmed', ErrorCode.PAYMENT_DECLINED);
    }
    return finished;
  }

  private async finishAttempt(
    booking: BookingWithEvent,
    attempt: PaymentAttemptRecord,
  ): Promise<BookingResponse | null> {
    if (
      booking.status === BookingStatus.PAID &&
      (attempt.state === PaymentState.REFUND_DUE ||
        attempt.state === PaymentState.REFUNDED)
    ) {
      await this.finishRefundedPayment(booking, attempt);
      return null;
    }
    if (attempt.state === PaymentState.REFUND_DUE) {
      await this.refundOutstanding(booking, attempt);
      return null;
    }
    const outcome = await this.payments.lookup(attempt.idempotencyKey);
    if (outcome === 'unknown' || outcome === 'declined') {
      await this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { state: PaymentState.DECLINED },
      });
      return null;
    }
    try {
      return toBookingResponse(await this.applyCharge(booking, attempt.id));
    } catch (error) {
      const current = await this.prisma.booking.findUnique({
        where: { id: booking.id },
      });
      if (current?.status === BookingStatus.PAID) {
        return toBookingResponse(
          await this.queries.findOwned(booking.userId, booking.id),
        );
      }
      await this.compensate(booking, attempt);
      throw error;
    }
  }

  private async finishInterruptedRefund(
    booking: BookingWithEvent,
  ): Promise<BookingWithEvent | null> {
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: {
        bookingId: booking.id,
        state: { in: [PaymentState.REFUND_DUE, PaymentState.REFUNDED] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!attempt) {
      return null;
    }
    await this.finishRefundedPayment(booking, attempt);
    return this.queries.findOwned(booking.userId, booking.id);
  }

  private async finishRefundedPayment(
    booking: BookingWithEvent,
    attempt: PaymentAttemptRecord,
  ): Promise<void> {
    if (attempt.state === PaymentState.REFUND_DUE) {
      const refunded = await this.payments.refund({
        bookingId: booking.id,
        amount: amountOf(booking),
        idempotencyKey: attempt.idempotencyKey,
      });
      if (!refunded) {
        throw badGateway('Refund was not confirmed', ErrorCode.REFUND_FAILED);
      }
    }
    await runWrite(this.prisma, async (tx) => {
      const locked = await this.inventory.lockEvent(tx, booking.eventId);
      if (!locked) {
        throw notFound('Event not found', ErrorCode.EVENT_NOT_FOUND);
      }
      await applyPaidRefund(
        tx,
        {
          id: booking.id,
          userId: booking.userId,
          eventId: booking.eventId,
          quantity: booking.quantity,
        },
        booking.event.salesClosedAt ? 'event_refunded' : 'refunded',
      );
    });
  }

  private async applyCharge(booking: BookingWithEvent, attemptId: string) {
    return runWrite(this.prisma, async (tx) => {
      const locked = await this.inventory.lockEvent(tx, booking.eventId);
      if (!locked) {
        throw notFound('Event not found', ErrorCode.EVENT_NOT_FOUND);
      }
      const freshEvent = await tx.event.findUnique({
        where: { id: booking.eventId },
      });
      if (!freshEvent || freshEvent.deletedAt || freshEvent.salesClosedAt) {
        throw conflict(
          'Reservation can no longer be paid',
          ErrorCode.BOOKING_NOT_PAYABLE,
        );
      }
      await this.inventory.releaseExpiredHolds(tx, booking.eventId, new Date());
      const updated = await tx.booking.updateMany({
        where: {
          id: booking.id,
          userId: booking.userId,
          status: BookingStatus.HELD,
          expiresAt: { gt: new Date() },
        },
        data: { status: BookingStatus.PAID, paidAt: new Date() },
      });
      if (updated.count !== 1) {
        throw conflict(
          'Reservation can no longer be paid',
          ErrorCode.BOOKING_NOT_PAYABLE,
        );
      }
      await recordBookingTransition(tx, {
        bookingId: booking.id,
        fromStatus: BookingStatus.HELD,
        toStatus: BookingStatus.PAID,
        reason: 'paid',
      });
      await tx.paymentAttempt.update({
        where: { id: attemptId },
        data: { state: PaymentState.APPLIED },
      });
      return tx.booking.findUniqueOrThrow({
        where: { id: booking.id },
        include: { event: true },
      });
    });
  }

  private async refundOutstanding(
    booking: BookingWithEvent,
    attempt: PaymentAttemptRecord,
  ): Promise<void> {
    const refunded = await this.payments.refund({
      bookingId: booking.id,
      amount: amountOf(booking),
      idempotencyKey: attempt.idempotencyKey,
    });
    if (!refunded) {
      throw badGateway('Refund was not confirmed', ErrorCode.REFUND_FAILED);
    }
    await this.prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { state: PaymentState.REFUNDED },
    });
  }

  private async compensate(
    booking: BookingWithEvent,
    attempt: PaymentAttemptRecord,
  ): Promise<void> {
    const current = await this.prisma.booking.findUnique({
      where: { id: booking.id },
    });
    if (current?.status === BookingStatus.PAID) {
      await this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { state: PaymentState.APPLIED },
      });
      return;
    }
    await this.prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { state: PaymentState.REFUND_DUE },
    });
    try {
      const refunded = await this.payments.refund({
        bookingId: booking.id,
        amount: amountOf(booking),
        idempotencyKey: attempt.idempotencyKey,
      });
      if (!refunded) {
        this.logger.error(`Refund was not confirmed for booking ${booking.id}`);
        return;
      }
      await this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { state: PaymentState.REFUNDED },
      });
    } catch (error) {
      this.logger.error(
        `Refund failed for booking ${booking.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
