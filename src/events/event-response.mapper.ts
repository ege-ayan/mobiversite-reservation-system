import type { Prisma } from '@/generated/prisma/client.js';

import type { EventResponse } from './dto/event-response.js';

export type EventResponseSource = {
  id: string;
  title: string;
  description: string;
  venue: string;
  startsAt: Date;
  ticketPrice: Prisma.Decimal;
  totalTickets: number;
  availableTickets: number;
  createdAt: Date;
  updatedAt: Date;
};

export function toEventResponse(event: EventResponseSource): EventResponse {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    venue: event.venue,
    startsAt: event.startsAt,
    ticketPrice: event.ticketPrice.toFixed(2),
    totalTickets: event.totalTickets,
    availableTickets: event.availableTickets,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}
