import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { EventRequest, EventUpdateRequest } from './event-request.js';

describe('EventRequest', () => {
  it('accepts an event that can be stored', async () => {
    const request = plainToInstance(EventRequest, body());

    await expect(validate(request)).resolves.toEqual([]);
  });

  it('lets an update keep a start time that is already in the past', async () => {
    const request = plainToInstance(
      EventUpdateRequest,
      body({ startsAt: '2020-01-01T00:00:00.000Z' }),
    );

    await expect(validate(request)).resolves.toEqual([]);
  });

  it('rejects a start time in the past', async () => {
    const request = plainToInstance(
      EventRequest,
      body({ startsAt: '2020-01-01T00:00:00.000Z' }),
    );

    const errors = await validate(request);
    expect(errors.map((error) => error.property)).toContain('startsAt');
  });

  it('rejects a price or ticket count the columns cannot store', async () => {
    const price = plainToInstance(
      EventRequest,
      body({ ticketPrice: 100_000_000 }),
    );
    const tickets = plainToInstance(
      EventRequest,
      body({ totalTickets: 2_147_483_648 }),
    );

    expect(await validate(price)).not.toEqual([]);
    expect(await validate(tickets)).not.toEqual([]);
  });
});

function body(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Mobiversite Live',
    description: 'Talks',
    venue: 'Kadikoy',
    startsAt: '2099-12-01T18:00:00.000Z',
    ticketPrice: 25,
    totalTickets: 10,
    ...overrides,
  };
}
