# Mobiversite Reservation System

HTTP API for an event ticket reservation system. A customer registers, holds tickets, pays for them, and cancels them. An administrator creates, replaces, and removes events. A hold that is not paid expires after 30 minutes and the tickets return to inventory.

The fastest way to run the whole system is Docker. The sections below also cover a local Node.js process on macOS, Linux, and Windows.

## What you get after startup

| Surface              | URL                                |
| -------------------- | ---------------------------------- |
| API                  | http://localhost:3000/api/v1       |
| OpenAPI UI           | http://localhost:3000/docs         |
| OpenAPI JSON         | http://localhost:3000/docs-json    |
| Health check         | http://localhost:3000/health       |
| Liveness             | http://localhost:3000/health/live  |
| Readiness            | http://localhost:3000/health/ready |
| Mock payment service | http://localhost:4000/payments     |

On startup the API container applies database migrations and seeds an administrator plus one sample event, then listens. HTTP routes live under `/api/v1`. Health and `/docs` stay at the root.

| Account  | Value                     |
| -------- | ------------------------- |
| Email    | `admin@mobiversite.local` |
| Password | `change-me-admin`         |
| Role     | `ADMIN`                   |

`POST /api/v1/auth/register` always creates a `CUSTOMER`. There is no public way to register an administrator. Change the seeded admin with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables before the first start, or update `users.role` in MySQL afterwards.

The seeded event is **Mobiversite Live**, 1 June 2027, 100 tickets at `25.00`.

## Tech stack

| Piece           | Choice                                                    | Why it is here                                                                                                           |
| --------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Runtime         | Node.js 26                                                | Active LTS (Lithium, since 28 October 2026). Docker and CI use this line.                                                |
| Language        | TypeScript, `strict`                                      | Request and response types stay aligned with the database client.                                                        |
| HTTP framework  | NestJS 12 on Express                                      | Modules, guards, and dependency injection match the feature boundaries below.                                            |
| Database        | MySQL 8.4                                                 | Required by the challenge. InnoDB row locks and `CHECK` constraints are part of the inventory design.                    |
| Data access     | Prisma 7 with the MariaDB driver adapter                  | Schema, migrations, and a typed client. Prisma does not model MySQL `CHECK` constraints, so those live in migration SQL. |
| Auth            | Passport JWT, `bcryptjs` (12 rounds)                      | Stateless API. The password hash is never returned.                                                                      |
| Validation      | `class-validator` on inputs, Zod on environment variables | Bad bodies become 400 before they reach a service. The process refuses to boot when required configuration is missing.   |
| API docs        | OpenAPI via `@nestjs/swagger` at `/docs`                  | Every route, status, and example is generated from the controllers. Authorize accepts a pasted bearer token or the account email and password. |
| Jobs            | `@nestjs/schedule`                                        | Three independent minute jobs: expired holds, unfinished payments, and event cancellations.                              |
| Rate limit      | `@nestjs/throttler`, memory or Redis                      | `RATE_LIMIT_STORE` selects the counter. Redis shares login and register limits across API instances.                     |
| Tests           | Vitest and Supertest                                      | Unit tests mock the database. End-to-end tests run against MySQL.                                                        |
| Lint and format | oxlint, Prettier                                          | `npm run ci` typechecks, lints, checks formatting, and runs unit tests.                                                  |
| Packaging       | Multi-stage Docker image, Compose, GHCR                   | One command starts the API, MySQL, Redis, and the mock payment service. A `v*` tag publishes the image.                  |

## Requirements

Docker path:

- Docker Desktop (macOS or Windows) or Docker Engine plus the Compose plugin (Linux)
- Git

Local API path:

- Node.js 26 (Active LTS). Node.js 24 and 22 are still supported by Node and can run this app, but Docker and CI use 26.
- npm 11 (ships with Node 26). npm 10 is enough on Node 22 or 24.
- A reachable MySQL 8.4 server, either from Compose or installed on the machine

Check the tools:

```bash
docker compose version
node --version
npm --version
```

On Windows the same commands work in PowerShell, Command Prompt, and Git Bash.

## Run with Docker

This is the path to use for a review. It does not need a local Node.js install.

From the repository root:

```bash
docker compose up --build
```

The first build installs dependencies and compiles TypeScript. Later starts reuse the image until the source changes. Compose waits until MySQL is healthy. The API container then applies migrations, seeds the admin and the sample event, and listens on port 3000 once Redis and the payment mock are ready. `NODE_ENV` inside Compose is `development`, so the example `JWT_SECRET` is accepted and the mock payment header works.

The API container sets `RATE_LIMIT_STORE=redis`, so every replica shares one login counter. A process started with `npm run start:dev` keeps the in-process counter unless `.env` points it at Redis.

Stop it with `Ctrl+C`. Add `-d` to run in the background, then stop it with:

```bash
docker compose down
```

`docker compose down` keeps the MySQL volume, so accounts and events survive a restart. To delete the database as well:

```bash
docker compose down -v
```

### macOS and Linux

Open a terminal in the project directory and run the commands above. `curl` is already available:

```bash
curl http://localhost:3000/health
```

A healthy process returns `{"status":"ok"}`. That check also runs `SELECT 1` against MySQL. If the database is down, the route returns 503.

Log in as the seeded administrator:

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@mobiversite.local","password":"change-me-admin"}'
```

Copy `accessToken` from the JSON and call a protected route:

```bash
curl http://localhost:3000/api/v1/auth/me \
  -H "authorization: Bearer PASTE_THE_TOKEN"
```

### Windows

Install [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) and start it before `docker compose`. Use a terminal opened in the project folder. PowerShell, Command Prompt, and Git Bash can all run `docker compose up --build`.

PowerShell aliases `curl` to `Invoke-WebRequest`. Call `curl.exe` when you want the real curl flags.

Health check, PowerShell or Command Prompt:

```bat
curl.exe http://localhost:3000/health
```

Login in PowerShell. A single-quoted JSON string is literal in PowerShell, which is what the request body needs:

```powershell
curl.exe -s -X POST http://localhost:3000/api/v1/auth/login `
  -H "content-type: application/json" `
  -d '{"email":"admin@mobiversite.local","password":"change-me-admin"}'
```

Login in Command Prompt. Use a caret for line continuation, and escape the quotes inside JSON:

```bat
curl.exe -s -X POST http://localhost:3000/api/v1/auth/login ^
  -H "content-type: application/json" ^
  -d "{\"email\":\"admin@mobiversite.local\",\"password\":\"change-me-admin\"}"
```

Git Bash on Windows accepts the macOS and Linux `curl` examples unchanged.

If port 3000, 3306, or 4000 is already taken, stop the other process or change the left-hand side of the port mapping in `compose.yml` (`"3001:3000"` publishes the API on 3001).

### What the containers do

| Service   | Image                                              | Role                                                                                                                                                          |
| --------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`     | Built from the `Dockerfile`                        | Applies migrations, runs `prisma/seed.mjs`, then the NestJS process. The image entrypoint is `node dist/main.js`; Compose wraps that with migrate and seed. |
| `mysql`   | `mysql:8.4`                                        | Database `mobiversite`, user `mobiversite`, password `mobiversite`, root password `root`.          |
| `payment` | `node:26-alpine` running `mock-payment/server.mjs` | Always-on stand-in for the payment provider.                                                       |
| `redis`   | `redis:7-alpine`                                   | Shared login and booking rate-limit counters when `RATE_LIMIT_STORE=redis`. Reachable only as `redis` on the Compose network, so a Redis already listening on the host does not block startup. |

The API image is built in two stages. The first installs every dependency, generates the Prisma client, and compiles to `dist`. The second installs production dependencies only, copies `dist` and `prisma`, and runs as the `node` user.

MySQL data lives in the `mysql_data` volume. `docker/mysql/init.sql` runs only when that volume is created for the first time. It grants the app user enough privilege to create Prisma's shadow database, which `prisma migrate dev` needs. An existing volume does not replay init scripts. After `docker compose down -v`, the next `up` creates a fresh volume and runs the script again.

## Run the API on the host

Use this when you want file watching and a debugger. MySQL and the payment mock can still come from Docker.

### 1. Start MySQL and the mock

```bash
docker compose up mysql payment
```

Leave that terminal running, or add `-d`.

### 2. Configure the environment

macOS, Linux, and Git Bash:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Windows Command Prompt:

```bat
copy .env.example .env
```

`.env.example` points `DATABASE_URL` at `localhost:3306` and `PAYMENT_SERVICE_URL` at `http://localhost:4000`. A URL that already ends in `/payments` is accepted too. Those match the published Compose ports. The file is read by Nest, by Prisma, and by `npm run db:seed`. `.env` is gitignored.

Leave `JWT_SECRET` unset for local development. The API and Compose then use `1234567891011121314151617181920212223242526272829303132`, the numbers 1 through 32 written in order. Compose sets `NODE_ENV=development`. A production process requires its own secret of at least 32 characters and does not accept that default. The image itself defaults to `NODE_ENV=production` when it is run outside this Compose file.

### 3. Install, migrate, seed, and start

```bash
npm ci
npx prisma migrate deploy
npm run build
npm run db:seed
npm run start:dev
```

`npm run db:seed` needs `dist/` because the seed script imports the compiled Prisma client. `npm run build` creates it. The seed is safe to run more than once: it upserts the admin by email and the sample event by a fixed id, and it does not reset a password or ticket counts that have already changed.

`npm run start:dev` generates the Prisma client before Nest starts watching. The generated client is written to `src/generated` and is not committed.

On Windows the same four npm commands work in PowerShell and Command Prompt. `npx` is installed with npm.

### Environment variables

| Variable                           | Required | Default                   | Meaning                                                                                                                                                                                                    |
| ---------------------------------- | -------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                         | no       | `development`             | `development`, `test`, or `production`. Production rejects a short `JWT_SECRET`.                                                                                                                           |
| `PORT`                             | no       | `3000`                    | HTTP port.                                                                                                                                                                                                 |
| `DATABASE_URL`                     | yes      |                           | MySQL URL, for example `mysql://mobiversite:mobiversite@localhost:3306/mobiversite`.                                                                                                                       |
| `JWT_SECRET`                       | production | numbers 1 through 32      | HMAC secret for access tokens. Development and test use `1234567891011121314151617181920212223242526272829303132` when this is unset. Production requires at least 32 characters. |
| `JWT_EXPIRES_IN_SECONDS`           | no       | `86400`                   | Access token lifetime. One day. Logout does not revoke it.                                                                                                                                                 |
| `REFRESH_TOKEN_EXPIRES_IN_SECONDS` | no       | `604800`                  | Refresh token lifetime. Seven days. Stored as a SHA-256 hash.                                                                                                                                              |
| `PAYMENT_SERVICE_URL`              | yes      |                           | Origin of the payment service, for example `http://localhost:4000`. A URL that already ends in `/payments` is accepted. Charges go to `/payments`, refunds to `/refunds`, and lookups to `/payments/:key`. |
| `PAYMENT_WEBHOOK_SECRET`           | no       | `dev-webhook-secret`      | HMAC secret for `POST /api/v1/webhooks/payments`. Production requires at least 32 characters.                                                                                                              |
| `RESERVATION_HOLD_MS`              | no       | `1800000`                 | How long an unpaid hold lasts. 30 minutes, or until the event starts, whichever is sooner.                                                                                                                 |
| `AUTH_RATE_LIMIT`                  | no       | `10`                      | Login and register requests allowed per client address per window.                                                                                                                                         |
| `AUTH_RATE_TTL_MS`                 | no       | `60000`                   | Length of that window.                                                                                                                                                                                     |
| `BOOKING_RATE_LIMIT`               | no       | `30`                      | Reserve, pay, and cancel requests allowed per customer per window.                                                                                                                                         |
| `BOOKING_RATE_TTL_MS`              | no       | `60000`                   | Length of that window.                                                                                                                                                                                     |
| `MAX_ACTIVE_TICKETS_PER_EVENT`     | no       | `10`                      | Tickets one customer may hold or have paid for on a single event.                                                                                                                                          |
| `RATE_LIMIT_STORE`                 | no       | `memory`                  | `memory` counts inside this process. `redis` shares that counter across API instances.                                                                                                                     |
| `REDIS_URL`                        | if redis |                           | Required when `RATE_LIMIT_STORE` is `redis`. Example: `redis://localhost:6379`.                                                                                                                            |
| `TRUST_PROXY`                      | no       | `0`                       | How many reverse proxies sit in front of the API. `0` ignores `X-Forwarded-For`, so a client cannot pick its own rate-limit address.                                                                      |
| `DATABASE_POOL_SIZE`               | no       | `20`                      | MySQL connections in the API pool.                                                                                                                                                                         |
| `RUN_JOBS`                         | no       | `true`                    | Minute jobs for expiry, payment reconciliation, and event cancellation. Set `false` on extra API replicas and leave it `true` on one of them.                                                              |
| `SWAGGER_ENABLED`                  | no       | on outside production     | Serves `/docs`. Production leaves it off unless this is `true`. Compose turns it on so a review can open the docs.                                                                                         |
| `ADMIN_EMAIL`                      | no       | `admin@mobiversite.local` | Seed only. Not read by the HTTP process.                                                                                                                                                                   |
| `ADMIN_PASSWORD`                   | no       | `change-me-admin`         | Seed only.                                                                                                                                                                                                 |

Unknown or missing required variables abort startup. The Zod schema is in `src/config/env.validation.ts`.

## Walk through a reservation

Statuses:

```mermaid
stateDiagram-v2
  [*] --> HELD: customer reserves
  HELD --> PAID: payment mock confirms
  HELD --> CANCELLED: customer cancels before payment
  HELD --> EXPIRED: hold reaches 30 minutes
  PAID --> REFUNDED: customer cancels, or an admin deletes the event
```

If the refund call fails, the reservation stays `PAID` and an event delete does not hide the event. Repeating the request tries the refund again. The mock treats a repeated refund of the same booking as the same refund.

1. Register a customer with `POST /api/v1/auth/register`. The password must be 12 to 72 characters and at most 72 UTF-8 bytes, because bcrypt only uses the first 72 bytes. The email is at most 255 characters, trimmed, and stored in lowercase. A duplicate email returns 409 with code `EMAIL_TAKEN`, including a different capitalization of the same address. The response has no password hash. Login and register are limited to 10 requests per minute per client address. The 11th returns 429.
2. `POST /api/v1/auth/login` returns an access token, a refresh token, and both lifetimes. `POST /api/v1/auth/refresh` rotates the refresh token. `POST /api/v1/auth/logout` revokes the refresh token and returns 204. The access token stays valid until it expires. `GET /api/v1/auth/me` returns the user for the access token. A token whose user row has been deleted is rejected, because every authenticated request loads the user from MySQL.
3. As the admin, `POST /api/v1/events` creates an event. `startsAt` must be in the future. `PUT /api/v1/events/:id` may set a start that is already in the past, so an admin can edit a started event. `ticketPrice` is a non-negative number with at most two decimal places, up to `99999999.99`. `totalTickets` is an integer from 1 to `2147483647`. `availableTickets` starts equal to `totalTickets`.
4. As the customer, `GET /api/v1/events` lists events that are still on sale and have not started yet, soonest first. Pass `from` and `to` (ISO-8601 instants, inclusive) to choose a different window, including events that already started. `q` of 3 or more searchable characters is a full-text search on the title. Boolean operators such as `+`, `-`, and parentheses are removed before that search, so a query cannot make MySQL reject the statement. A shorter `q` stays a case-insensitive substring. `GET /api/v1/events/:id` returns one event that is still on sale.
5. `POST /api/v1/bookings` with `{ "eventId", "quantity" }` holds tickets. `quantity` is from 1 up to `MAX_ACTIVE_TICKETS_PER_EVENT` (10 by default), and that same cap is the number of active tickets (`HELD` or `PAID`) one customer can have on the same event. The hold stores the ticket price at that moment, so a later price change does not rewrite the booking. The response status is `HELD` and includes `totalAmount` (`ticketPrice` times `quantity`). `expiresAt` is 30 minutes ahead, or the event start, whichever comes first. Reserve, pay, and cancel are limited to 30 requests per minute per customer.
6. Send the header `Idempotency-Key` on that POST when the client might retry. The same customer, the same key, and the same body return the original booking. The same key with a different `eventId` or `quantity` returns 409. Another customer may reuse the same key. The key is 1 to 255 characters from letters, digits, `.`, `_`, `:`, and `-`.
7. `POST /api/v1/bookings/:id/payment` calls the payment service. `{ "paid": true }` moves the booking to `PAID` and sets `paidAt`. A declined charge leaves the hold in place and returns 409 with code `PAYMENT_DECLINED`. A provider 5xx returns 502 and leaves the attempt `PENDING`, so a charge that may have succeeded is not recorded as a decline. Send `x-mock-payment` with `decline`, `error`, `timeout`, `slow`, or `error-after-charge` outside production. Production ignores that header. A later attempt uses a new idempotency key, so the customer can try again until the hold expires. Each attempt is stored. If the process dies after the provider accepts the charge, a job asks `GET /payments/:key` and either marks the booking paid or refunds it. The provider can also `POST /api/v1/webhooks/payments` with an HMAC of the raw body in `x-payment-signature`.
8. `POST /api/v1/bookings/:id/cancel` on a hold returns the tickets, sets `CANCELLED`, and sets `cancelledAt`. On a paid booking it refunds first, then sets `REFUNDED` and `refundedAt` and returns the tickets. A refund that the provider refuses returns 502 with code `REFUND_FAILED`. A paid booking cannot be cancelled after `startsAt`.
9. `GET /api/v1/bookings` and `GET /api/v1/bookings/:id` return only the caller's reservations, newest first. A hold whose `expiresAt` has passed is shown as `EXPIRED` even if the background job has not written that status yet. Each response includes `paidAt`, `cancelledAt`, and `refundedAt` (`null` when that transition has not happened).
10. An admin replaces an event with `PUT /api/v1/events/:id` (every field is required) or starts cancellation with `DELETE /api/v1/events/:id`. A replacement is rejected once sales are closed. Delete returns 202 and `{ "id", "status": "CANCELLING" }`. Sales close immediately, so a new hold cannot land while refunds run. A background job cancels unpaid holds, refunds paid bookings, and then sets `deleted_at`. The job takes a MySQL named lock, so two containers do not refund the same event at once. Repeating the delete while cancellation is in progress returns 202. After `deleted_at` is set, the next delete returns 404. A hidden event disappears from the catalog. `GET /api/v1/admin/events` lists every event, including ones the catalog hides, with `status` of `ON_SALE`, `PAST`, `CANCELLING`, or `DELETED`, plus held tickets, paid tickets, and paid revenue. `status` query values are `all`, `on_sale`, `upcoming`, `past`, `cancelling`, and `deleted`. `GET /api/v1/admin/events/:id` returns one of those rows.
11. `GET /api/v1/events/:id/bookings` lists every reservation for that event and includes the customer email. Customers receive 403. Domain errors include a `code` field, for example `SOLD_OUT` or `EVENT_NOT_FOUND`. A 429 from the rate limiter uses `RATE_LIMITED`.

List responses look like `{ "items": [...], "nextCursor": "..." }`. Pass `nextCursor` back as the `cursor` query parameter. `limit` defaults to 20 and must be from 1 to 100. A bad cursor returns 400.

Role rules are enforced on the route, not only in the UI. A customer who calls an admin route receives 403. An admin who calls a booking route receives 403. A missing or invalid token receives 401.

### Payment mock

`mock-payment/server.mjs` is a small Node process with no dependencies. It is an ES module, so `node mock-payment/server.mjs` works from this repository.

| Request                                                    | Behavior                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                              | `{ "status": "ok" }`                                                                                          |
| `GET /payments/:idempotencyKey`                            | The stored result. A declined charge is HTTP 200 and `{ "paid": false }`. 404 means the key was never stored. |
| `POST /payments`                                           | `{ "paid": true }` with status 200                                                                            |
| `POST /payments` plus `x-mock-payment: decline`            | `{ "paid": false }` with status 402. The result is stored.                                                    |
| `POST /payments` plus `x-mock-payment: error`              | Status 500. Nothing is stored.                                                                                |
| `POST /payments` plus `x-mock-payment: error-after-charge` | Stores `{ "paid": true }`, then returns 500. Reconciliation can recover the charge.                           |
| `POST /payments` plus `x-mock-payment: timeout`            | Stores the payment immediately, then answers after 8 seconds.                                                 |
| `POST /payments` plus `x-mock-payment: slow`               | Waits 2 seconds, then returns 200.                                                                            |
| `POST /payments` again with the same `Idempotency-Key`     | The first result, with the original status, and no second webhook                                             |
| `POST /refunds` with `{ "bookingId", "amount" }`           | `{ "refunded": true }`. A later payment for that booking is treated as a new charge.                          |

The API sends `Idempotency-Key` itself. The first attempt uses the booking id. A retry after a decline uses a new key. You do not set that header on the payment route. Send `x-mock-payment` on `POST /api/v1/bookings/:id/payment` when you want one of the modes above. The API ignores that header when `NODE_ENV` is `production`.

When `PAYMENT_WEBHOOK_URL` and `PAYMENT_WEBHOOK_SECRET` are set, the mock posts `{ "idempotencyKey", "paid" }` to that URL after a stored charge. The header `x-payment-signature` is the hex HMAC-SHA256 of the raw body. A replay of the same idempotency key does not notify again. Compose points the webhook at `http://api:3000/api/v1/webhooks/payments`.

## Architecture

The code is grouped by feature. Each feature is a Nest module with a controller, a service, and request or response types.

```
src/
  auth/         registration, login, refresh, logout, JWT, roles
  rate-limit/   memory or Redis counters for login and bookings
  events/       catalog, admin list, cancellation
  bookings/     reserve, pay, refund completion, query, and expiry
  inventory/    row lock and return of expired holds
  payment/      payment gateway client
  webhooks/     signed payment callbacks
  scheduler/    expiry, reconciliation, and cancellation jobs
  common/       cursor pagination, error codes, named locks, request id
  config/       environment schema, validation pipe, OpenAPI, helmet
  health/       liveness, readiness, and the combined health check
  prisma/       shared Prisma client and write retries
prisma/         schema, migrations, seed
mock-payment/   payment double used by Compose
database/       SQL dump for reviewers
requests/       REST Client examples
scripts/load/   optional k6 script
```

`EventsModule` asks `EventCancellationService` to close sales and finish refunds. It does not import the bookings module. Charge and refund completion live with the booking, and `payment/` only talks to the provider. `BookingsService` stays a thin facade over reservation, query, charge, and expiry so HTTP and the scheduler share one entry. The payment HTTP client is behind the `PAYMENT_GATEWAY` injection token, so tests replace the whole gateway without starting a server. A deadlock or lock-wait timeout retries the write transaction up to three times before the client sees 503.

### Inventory and overselling

A popular event is a single row. Two customers asking for the last ticket must not both succeed.

The reservation transaction locks that row with `SELECT ... FOR UPDATE`, then decrements `available_tickets` only where `available_tickets >= quantity`. The conditional update is what makes the write safe. The lock keeps the check and the write in one place so expiry, cancellation, and payment for the same event cannot interleave and double-count tickets.

Replacing an event takes the same lock. Capacity changes by the difference between the new total and the old total (`increment`), not by writing a freshly computed absolute number. An absolute write would erase a sale that landed after the admin read the row. The update also refuses a new total lower than the tickets already held or paid.

MySQL `CHECK` constraints reject an `available_tickets` value outside `0 .. total_tickets`, and a booking `quantity` below 1. Those constraints are in the migration SQL because Prisma's schema language does not represent them. They are a backstop for bugs and for raw SQL, not the mechanism the API uses on the happy path.

This design is the right one for the challenge. A flash sale large enough to queue on one row would move the ticket counter to something like Redis and keep MySQL as the ledger. The API pool keeps 20 connections, and a lock wait, a deadlock, or a transaction that waits too long becomes 503 so the client can retry. With `RATE_LIMIT_STORE=redis` the API process is stateless, so more than one API container can run behind a load balancer and share the login and booking limits. See the rate-limit note below.

### Expiry

Unpaid holds die in two ways, and both return the tickets once.

- A cron job runs every minute. It asks MySQL for a named lock (`GET_LOCK`) on its own connection and holds that lock until the sweep finishes, so two containers do not scan the same batch. The lock is connection-scoped, so it is taken on a dedicated connection rather than on a pooled Prisma connection that might be returned to the pool mid-sweep. If the lock is busy, that run does nothing. The next minute tries again.
- Any reserve, cancel, pay, or event update for an event also releases that event's expired holds inside its own transaction. A customer does not wait for the cron to buy a ticket whose previous hold has already lapsed.

The sweep is batched (200 events) and each event is committed on its own, so one failure does not roll back the others. Reads treat a `HELD` row past `expiresAt` as `EXPIRED` without writing, which keeps `GET /api/v1/bookings` honest if the cron is late. The inventory count stays low until a write path or the cron actually returns the tickets. That split is deliberate: a read should not take a row lock. Expiry, payment reconciliation, and event cancellation are separate cron methods, and each takes its own named lock. One throwing does not skip the others. `RUN_JOBS=false` turns all three off, which is how extra API replicas avoid doing the same work.

### Payment outside the transaction

The payment HTTP call happens after the hold is known to be valid and before the status update commits. The event row is not locked while the mock is on the network. Locking it for the whole round trip would stall every other buyer of that event.

Before that call the API writes a `payment_attempts` row. The provider key is the booking id for the first attempt and `bookingId:2`, `bookingId:3`, and so on after a decline. If the process dies after the provider accepts the charge, the row stays `PENDING`. A provider 5xx does the same: the attempt is not marked declined, because the charge may have landed. Once a minute the API asks `GET /payments/:key`. A stored payment is applied, or refunded when the hold can no longer be paid. An unknown key is marked declined so the customer can try again. A second pay request for the same booking waits if an attempt is still in flight. A webhook with the same idempotency key applies the same result. If the booking is already `PAID`, the later writer does not refund.

That leaves a smaller gap. The mock can say paid, and then the hold can expire or be cancelled before the status update. The API then calls `/refunds` and leaves the attempt `REFUND_DUE` if that call fails, so the next pass retries it. If another request already committed `PAID`, the loser does not refund. The winner keeps the ticket and the single charge.

A customer refund or an event refund marks the attempt `REFUND_DUE` before calling the provider, and marks the booking `REFUNDED` only after that call succeeds. If the process dies in between, the booking stays `PAID` and the attempt stays `REFUND_DUE` (or `REFUNDED` if an older process got that far). The next minute finishes the booking and returns the tickets without charging the customer again. A later pay request for that booking does the same before it reports the reservation as paid.

### Price snapshot and soft delete

`bookings.ticket_price` is copied from the event at reserve time. The amount sent to the payment service is that snapshot times `quantity`. Editing the event price later changes what a new hold will pay, not what an existing hold will pay.

Deleting an event sets `sales_closed_at` and returns 202. `PUT` is rejected while that cancellation is in progress. Refunds then run in the background, under the cancellation lock. If that lock is already held, a follow-up cancellation waits up to 30 seconds and then finishes the event if the first worker has not already done so. The minute cron skips the lock when it is busy. `deleted_at` is set only after no `HELD` or `PAID` booking remains. The catalog requires both timestamps to be null. `sales_closed_at` without `deleted_at` means `CANCELLING`. The catalog index is `(deleted_at, sales_closed_at, starts_at, id)`. A title search of 3 or more searchable characters uses the full-text index `events_title_idx`, with boolean operators stripped out first. Shorter queries stay a substring match, because MySQL full-text ignores very short tokens. If a refund fails, `deleted_at` stays null and the next minute tries again.

### Authentication

Access tokens carry the user id, email, and role. They are signed with HS256 for issuer `mobiversite` and audience `mobiversite-api`, and they expire. The JWT strategy still loads the user on each request so a deleted account stops working immediately and a role change is visible without waiting for the token to expire.

Login also returns an opaque refresh token. Only its SHA-256 hash is stored. Refresh revokes the presented token with a conditional update and issues a new pair. Presenting a token that was already revoked revokes the rest of that user's refresh tokens too, so a stolen token cannot keep minting sessions. A revoked or expired refresh token returns 401. Logout revokes the refresh token and always returns 204. The access token is unchanged until it expires.

Login always runs a bcrypt compare. When the email does not exist, it compares against a dummy hash so the response time does not reveal which emails are registered. The error message is the same for a wrong password and an unknown email. Passwords longer than 72 bytes are rejected before hashing, because bcrypt would silently ignore the extra bytes.

Registration does not accept a `role` field. Extra properties are rejected (`forbidNonWhitelisted`).

Login and register are rate limited. `RATE_LIMIT_STORE=memory` (the default) keeps the counter in this process. That is the right setting for one instance and for the test suite. `RATE_LIMIT_STORE=redis` with `REDIS_URL` stores the same counter in Redis, so a load balancer cannot multiply the login budget by the number of API containers. The Redis path is a fixed window: the first hit starts the TTL, the request past the limit is blocked for that window, and later hits in the block do not increment the counter. Both keys share a Redis hash tag, so they stay on one slot if the store is later moved to a cluster. Compose runs this Redis store. `TRUST_PROXY` defaults to 0, so `X-Forwarded-For` is ignored and a client cannot choose a fresh rate-limit budget. Set it to `1` only when a single trusted proxy is in front of the API. If Redis is unreachable, login and register return an error. A down limiter must not turn into an open login route.

Passwords are hashed with bcrypt at 12 rounds. The dummy hash used for unknown emails is created once per process.

### Other decisions

- **UUID v7 primary keys.** Time-ordered identifiers, stored as `CHAR(36)`.
- **Cursor pagination.** Offset pages drift when rows are inserted at the top of a newest-first list. The cursor is the last row's sort time plus id, encoded as URL-safe base64.
- **Decimal money as strings.** Prices travel as `"25.00"` so JSON numbers do not round currency.
- **Helmet and CORS.** Security headers are on. Content Security Policy stays off while Swagger is enabled, so the UI can load, and it is on when Swagger is off. CORS allows browser clients during review.
- **Errors.** Domain failures include a `code`, for example `SOLD_OUT`. Validation failures use `VALIDATION_ERROR` and rate limits use `RATE_LIMITED`. A unique-constraint failure becomes 409, a missing record 404, and a check-constraint or overflow failure 400. Other database failures become a generic 500 without the SQL text. An unexpected error is logged and returned as `INTERNAL_ERROR`.
- **Request log.** `pino-http` writes method, path, status, and duration when the response finishes. Successful `GET /health`, `/health/live`, and `/health/ready` probes are omitted, because Compose calls them every few seconds. A probe that returns 4xx or 5xx is still written. `x-request-id` is echoed when it is a single token of letters, digits, `.`, `_`, or `-` up to 200 characters. Otherwise the API generates a UUID. Authorization and cookie headers are redacted. Logs are silent when `NODE_ENV` is `test`.
- **Health.** `GET /health` is public and checks the database plus the rate-limit store. `GET /health/live` only checks that the process is up. `GET /health/ready` checks the database and the rate-limit store. Compose can keep using `/health`.
- **Booking history.** Each status change writes a `booking_events` row with `from_status`, `to_status`, and a reason such as `reserved`, `paid`, `cancelled`, `expired`, `refunded`, `event_cancelled`, or `event_refunded`. `EXPIRED` does not set `cancelled_at`.

## Database

The Prisma schema is `prisma/schema.prisma`. The tables are `users`, `events`, `bookings`, `booking_events`, `payment_attempts`, and `refresh_tokens`.

`users` has `email` (unique), `password_hash`, and `role` (`CUSTOMER` or `ADMIN`).

`events` has the public fields (`title`, `description`, `venue`, `starts_at`, `ticket_price`, `total_tickets`, `available_tickets`) plus `deleted_at` and `sales_closed_at`. Sales close before refunds run, so a delete cannot race a new hold. The catalog index is `(deleted_at, sales_closed_at, starts_at, id)`.

`bookings` has `user_id`, `event_id`, `quantity`, `status` (`HELD`, `PAID`, `CANCELLED`, `EXPIRED`, `REFUNDED`), a price snapshot, `expires_at`, `paid_at`, `cancelled_at`, `refunded_at`, and an optional idempotency key with a hash of the request body. The unique key is `(user_id, idempotency_key)`. MySQL allows many rows with a null key, so bookings that omit the header do not collide. The hot indexes are `(event_id, status, expires_at)` for expiry and `(event_id, created_at, id)` for the admin list. `booking_events` is the append-only history of those status changes. `refresh_tokens` stores the hash of an opaque refresh token.

`payment_attempts` records each charge: the provider idempotency key, the amount, and a state (`PENDING`, `DECLINED`, `APPLIED`, `REFUND_DUE`, `REFUNDED`). A declined attempt does not block the next one.

Apply migrations:

```bash
npx prisma migrate deploy
```

Create a new migration during development (needs the shadow-database grants from `docker/mysql/init.sql` on a fresh volume):

```bash
npx prisma migrate dev
```

### SQL dump

`database/mobiversite.sql` is a snapshot of the schema, the Prisma migration history, the seeded admin, and the sample event. The running app does not load this file. The API container applies `prisma/migrations` before it listens. Import the dump when you want the schema without running the API. Importing it and then running migrations is safe: the `_prisma_migrations` rows match the files in the repository, so `migrate deploy` does nothing.

Create the database first if it does not exist, then import.

macOS, Linux, and Git Bash, against the Compose MySQL:

```bash
docker compose exec -T mysql mysql -umobiversite -pmobiversite -e "CREATE DATABASE IF NOT EXISTS mobiversite;"
docker compose exec -T mysql mysql -umobiversite -pmobiversite mobiversite < database/mobiversite.sql
```

Windows PowerShell cannot use `<` for redirection. Pipe the file instead:

```powershell
Get-Content -Raw database\mobiversite.sql | docker compose exec -T mysql mysql -umobiversite -pmobiversite mobiversite
```

Command Prompt:

```bat
docker compose exec -T mysql mysql -umobiversite -pmobiversite mobiversite < database\mobiversite.sql
```

Refresh the file from a running Compose database. macOS, Linux, and Git Bash:

```bash
docker compose exec mysql mysqldump -umobiversite -pmobiversite --no-tablespaces mobiversite > database/mobiversite.sql
```

PowerShell writes UTF-16 if you use `>` on a native command. Use `cmd` for that redirection, or:

```powershell
docker compose exec mysql mysqldump -umobiversite -pmobiversite --no-tablespaces mobiversite | Set-Content -Encoding utf8 database\mobiversite.sql
```

A dump of a used database includes whatever bookings were created after the seed. The file in the repository is the schema plus the seed rows only.

## Tests

Unit tests do not need MySQL. End-to-end tests do. Point `DATABASE_URL` at a database you are willing to let tests write to. They delete rows they created: users ending in `@example.test`, and events whose title starts with `test-event-`.

macOS, Linux, and Git Bash:

```bash
cp .env.example .env
npm ci
npm run ci
npm run test:e2e
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
npm ci
npm run ci
npm run test:e2e
```

`npm run ci` is typecheck, lint, format check, and unit tests. `npm run test:e2e` runs the HTTP suite serially so concurrent cases do not trip over each other. The suite raises the auth rate limit so login storms in the tests are not throttled. Tests leave `RATE_LIMIT_STORE` unset, so they use the in-process counter and do not need Redis.

`npm ci` installs a Husky pre-push hook. The hook runs `npm run ci` before `git push`. GitHub Actions still runs the end-to-end suite, which needs MySQL and is too heavy for every local push. `HUSKY=0 git push` skips the hook. If a fresh clone does not run the hook, run `npm run prepare`.

GitHub Actions (`.github/workflows/ci.yml`) starts MySQL 8.4, runs `npm run ci`, applies migrations, and runs the end-to-end tests.

Useful single scripts: `npm test`, `npm run test:watch`, `npm run test:cov`, `npm run lint`, `npm run format`.

## Scripts

| Script                               | What it does                                                                |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `npm run start:dev`                  | Generate the client and start Nest in watch mode.                           |
| `npm run start:prod`                 | Run `node dist/main` after `npm run build`.                                 |
| `npm run build`                      | Generate the client and compile to `dist`.                                  |
| `npm run db:seed`                    | Upsert the admin and the sample event. Requires `dist`.                     |
| `npm run ci`                         | The same checks CI runs before the end-to-end suite.                        |
| `npx prisma migrate deploy`          | Apply pending migrations.                                                   |
| `npx prisma studio`                  | Optional table browser against `DATABASE_URL`.                              |
| `npm run prepare`                    | Point Git at the Husky hooks. `npm ci` already does this.                   |
| `k6 run scripts/load/reservation.js` | Optional load script. Raise `AUTH_RATE_LIMIT` first. Not part of CI.        |
| `requests/reservation.http`          | REST Client requests for register, login, reserve, pay, and the admin list. |

## Release

Pushing a version tag that starts with `v` builds this Dockerfile and publishes it to GitHub Container Registry. The tag has to be a semantic version, for example `v0.0.1`.

macOS, Linux, and Git Bash:

```bash
git tag v0.0.1
git push origin v0.0.1
```

Windows PowerShell and Command Prompt use the same two commands.

The workflow is `.github/workflows/release.yml`. It logs in with the workflow's `GITHUB_TOKEN` and pushes three tags. `OWNER/REPO` is the GitHub repository name, lowercased:

| Image                       | When                              |
| --------------------------- | --------------------------------- |
| `ghcr.io/OWNER/REPO:0.0.1`  | The tag, without the leading `v`. |
| `ghcr.io/OWNER/REPO:0.0`    | The major.minor line.             |
| `ghcr.io/OWNER/REPO:latest` | Each successful release.          |

The package is private until its visibility is changed under the repository's Packages page. Pulling a private package needs `docker login ghcr.io` with a GitHub token that can read packages.

## Troubleshooting

| Symptom                                                | What to check                                                                                                                                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose up` fails on the build                 | Docker is running, and the first build has network access to the npm registry.                                                                                                                                                  |
| API container restarts                                 | `docker compose logs api`. Migrations and the seed run in that same container before the process listens. A production `JWT_SECRET` or `PAYMENT_WEBHOOK_SECRET` shorter than 32 characters stops startup only when `NODE_ENV` is `production`. |
| `ECONNREFUSED 127.0.0.1:3306` from `npm run start:dev` | MySQL is not published on the host. Start it with `docker compose up mysql`.                                                                                                                                                    |
| `P1001` or migrate cannot connect                      | `DATABASE_URL` host is `localhost` on the host and `mysql` inside Compose. The example file and `compose.yml` already differ in that way.                                                                                       |
| Port already allocated                                 | Another process owns 3000, 3306, or 4000. Redis is not published to the host.                                                                                                                                                   |
| Login returns 500 and the log mentions Redis           | `RATE_LIMIT_STORE` is `redis` and `REDIS_URL` is wrong, or Redis is down. Compose sets both. A local process can stay on `memory`. Health then returns 503.                                                                     |
| Register returns 429                                   | The auth limit is 10 requests per minute. Wait, or raise `AUTH_RATE_LIMIT`.                                                                                                                                                     |
| Payment returns 502                                    | The mock is down, or `PAYMENT_SERVICE_URL` is wrong. From the host it must be `localhost`, not the Compose hostname `payment`.                                                                                                  |
| Seed says `Build the project before seeding`           | Run `npm run build` first.                                                                                                                                                                                                      |
| Admin login fails after a volume reset                 | The seed runs on API startup. If you imported the SQL dump instead, the password is still `change-me-admin`.                                                                                                                    |
| Windows `curl` posts the wrong body                    | You hit PowerShell's `curl` alias. Use `curl.exe`.                                                                                                                                                                              |
