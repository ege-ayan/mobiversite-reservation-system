import { Injectable } from '@nestjs/common';
import type { MockPaymentDecision } from '../payment/payment.client.js';
import { ChargeService } from '../payment/charge.service.js';
import { EventCancellationService } from '../events/event-cancellation.service.js';
import { BookingQueryService } from './booking-query.service.js';
import { ExpiryService } from './expiry.service.js';
import { ReservationService } from './reservation.service.js';
import type { AdminBookingPage } from './dto/admin-booking-page.js';
import type { BookingPage } from './dto/booking-page.js';
import type { BookingRequest } from './dto/booking-request.js';
import type { BookingResponse } from './dto/booking-response.js';
import type { PageQuery } from '../common/pagination/page-query.js';

@Injectable()
export class BookingsService {
  constructor(
    private readonly queries: BookingQueryService,
    private readonly reservations: ReservationService,
    private readonly charges: ChargeService,
    private readonly expiry: ExpiryService,
    private readonly cancellation: EventCancellationService,
  ) {}

  listForUser(userId: string, query: PageQuery): Promise<BookingPage> {
    return this.queries.listForUser(userId, query);
  }

  listForEvent(eventId: string, query: PageQuery): Promise<AdminBookingPage> {
    return this.queries.listForEvent(eventId, query);
  }

  findForUser(userId: string, bookingId: string): Promise<BookingResponse> {
    return this.queries.findForUser(userId, bookingId);
  }

  reserve(
    userId: string,
    request: BookingRequest,
    idempotencyKey?: string,
  ): Promise<BookingResponse> {
    return this.reservations.reserve(userId, request, idempotencyKey);
  }

  cancel(userId: string, bookingId: string): Promise<BookingResponse> {
    return this.reservations.cancel(userId, bookingId);
  }

  pay(
    userId: string,
    bookingId: string,
    options?: { decision?: MockPaymentDecision },
  ): Promise<BookingResponse> {
    return this.charges.pay(userId, bookingId, options);
  }

  settleReservations(eventId: string): Promise<void> {
    return this.cancellation.settleReservations(eventId);
  }

  releaseExpiredHolds(now = new Date()): Promise<number> {
    return this.expiry.releaseExpiredHolds(now);
  }

  reconcilePayments(now = new Date()): Promise<number> {
    return this.charges.reconcilePayments(now);
  }

  applyProviderResult(idempotencyKey: string, paid: boolean): Promise<void> {
    return this.charges.applyProviderResult(idempotencyKey, paid);
  }
}
