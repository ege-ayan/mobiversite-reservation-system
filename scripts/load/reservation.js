// Optional load check. Not part of CI.
// Raise AUTH_RATE_LIMIT and BOOKING_RATE_LIMIT before running, for example:
//   AUTH_RATE_LIMIT=1000 BOOKING_RATE_LIMIT=1000 k6 run scripts/load/reservation.js
// One customer can hold at most MAX_ACTIVE_TICKETS_PER_EVENT tickets, so each
// iteration registers its own user.

import http from 'k6/http';
import { check, sleep } from 'k6';

const base = __ENV.BASE_URL || 'http://localhost:3000';
const password = 'correct horse battery';

export const options = {
  vus: 20,
  iterations: 20,
};

export function setup() {
  const login = http.post(
    `${base}/api/v1/auth/login`,
    JSON.stringify({
      email: __ENV.ADMIN_EMAIL || 'admin@mobiversite.local',
      password: __ENV.ADMIN_PASSWORD || 'change-me-admin',
    }),
    { headers: { 'content-type': 'application/json' } },
  );
  const created = http.post(
    `${base}/api/v1/events`,
    JSON.stringify({
      title: `load-${Date.now()}`,
      description: 'Load test event',
      venue: 'Kadikoy',
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      ticketPrice: 25,
      totalTickets: 50,
    }),
    {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${login.json('accessToken')}`,
      },
    },
  );
  return { eventId: created.json('id') };
}

export default function (data) {
  const email = `load-${__VU}-${__ITER}-${Date.now()}@example.test`;
  const json = { headers: { 'content-type': 'application/json' } };
  http.post(
    `${base}/api/v1/auth/register`,
    JSON.stringify({ email, password }),
    json,
  );
  const login = http.post(
    `${base}/api/v1/auth/login`,
    JSON.stringify({ email, password }),
    json,
  );
  const reserved = http.post(
    `${base}/api/v1/bookings`,
    JSON.stringify({ eventId: data.eventId, quantity: 1 }),
    {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${login.json('accessToken')}`,
        'idempotency-key': `load-${__VU}-${__ITER}`,
      },
    },
  );
  check(reserved, {
    'reserved or sold out': (response) =>
      response.status === 201 || response.status === 409,
  });
  sleep(0.2);
}
