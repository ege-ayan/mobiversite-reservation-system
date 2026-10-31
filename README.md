# Mobiversite Reservation System

HTTP API for an event ticket reservation system. A customer registers, holds tickets, pays for them, and cancels them. An administrator creates, replaces, and removes events. A hold that is not paid expires after 30 minutes and the tickets return to inventory.

The fastest way to run the whole system is Docker. The sections below also cover a local Node.js process on macOS, Linux, and Windows.

## What you get after startup

| Surface              | URL                             |
| -------------------- | ------------------------------- |
| API                  | http://localhost:3000           |
| OpenAPI UI           | http://localhost:3000/docs      |
| OpenAPI JSON         | http://localhost:3000/docs-json |
| Health check         | http://localhost:3000/health    |
| Mock payment service | http://localhost:4000/payments  |

The API container applies database migrations and then seeds an administrator plus one sample event.

| Account  | Value                     |
| -------- | ------------------------- |
| Email    | `admin@mobiversite.local` |
| Password | `change-me-admin`         |
| Role     | `ADMIN`                   |

`POST /auth/register` always creates a `CUSTOMER`. There is no public way to register an administrator. Change the seeded admin with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables before the first start, or update `users.role` in MySQL afterwards.

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
| API docs        | OpenAPI via `@nestjs/swagger` at `/docs`                  | Every route, status, and example is generated from the controllers.                                                      |
| Jobs            | `@nestjs/schedule`                                        | One cron releases expired holds and reconciles payment attempts that were left unfinished.                  |
| Rate limit      | `@nestjs/throttler`, memory or Redis                      | `RATE_LIMIT_STORE` selects the counter. Redis shares login and register limits across API instances.                     |
| Tests           | Vitest and Supertest                                      | Unit tests mock the database. End-to-end tests run against MySQL.                                                        |
| Lint and format | oxlint, Prettier                                          | `npm run ci` typechecks, lints, checks formatting, and runs unit tests.                                                  |
| Packaging       | Multi-stage Docker image, Compose, GHCR                   | One command starts the API, MySQL, Redis, and the mock payment service. A `v*` tag publishes the image.                   |

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

The first build installs dependencies and compiles TypeScript. Later starts reuse the image until the source changes. Compose waits until MySQL, Redis, and the payment mock are healthy, then the API runs migrations, seeds the admin and the sample event, and listens on port 3000.

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
curl -s -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@mobiversite.local","password":"change-me-admin"}'
```

Copy `accessToken` from the JSON and call a protected route:

```bash
curl http://localhost:3000/auth/me \
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
curl.exe -s -X POST http://localhost:3000/auth/login `
  -H "content-type: application/json" `
  -d '{"email":"admin@mobiversite.local","password":"change-me-admin"}'
```

Login in Command Prompt. Use a caret for line continuation, and escape the quotes inside JSON:

```bat
curl.exe -s -X POST http://localhost:3000/auth/login ^
  -H "content-type: application/json" ^
  -d "{\"email\":\"admin@mobiversite.local\",\"password\":\"change-me-admin\"}"
```

Git Bash on Windows accepts the macOS and Linux `curl` examples unchanged.

If port 3000, 3306, or 4000 is already taken, stop the other process or change the left-hand side of the port mapping in `compose.yml` (`"3001:3000"` publishes the API on 3001).

### What the containers do

| Service   | Image                                             | Role                                                                                                        |
| --------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `api`     | Built from the `Dockerfile`                       | NestJS process. On start it runs `prisma migrate deploy`, then `prisma/seed.mjs`, then `node dist/main.js`. |
| `mysql`   | `mysql:8.4`                                        | Database `mobiversite`, user `mobiversite`, password `mobiversite`, root password `root`.                    |
| `payment` | `node:26-alpine` running `mock-payment/server.mjs` | Always-on stand-in for the payment provider.                                                                 |
| `redis`   | `redis:7-alpine`                                   | Shared login and booking rate-limit counters when `RATE_LIMIT_STORE=redis`.                                 |

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

`JWT_SECRET` in the example is `change-me`. That is accepted when `NODE_ENV` is `development` or `test`. Compose sets `NODE_ENV=production` inside the API container, and a production secret shorter than 32 characters prevents the process from starting. The Compose default secret already meets that length. Replace it for any real deployment.

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

| Variable                 | Required | Default                   | Meaning                                                                                                       |
| ------------------------ | -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`               | no       | `development`             | `development`, `test`, or `production`. Production rejects a short `JWT_SECRET`.                              |
| `PORT`                   | no       | `3000`                    | HTTP port.                                                                                                    |
| `DATABASE_URL`           | yes      |                           | MySQL URL, for example `mysql://mobiversite:mobiversite@localhost:3306/mobiversite`.                          |
| `JWT_SECRET`             | yes      |                           | HMAC secret for access tokens.                                                                                |
| `JWT_EXPIRES_IN_SECONDS` | no       | `86400`                   | Access token lifetime. One day.                                                                               |
| `PAYMENT_SERVICE_URL`    | yes      |                           | Origin of the payment service, for example `http://localhost:4000`. A URL that already ends in `/payments` is accepted. Charges go to `/payments`, refunds to `/refunds`, and lookups to `/payments/:key`. |
| `RESERVATION_HOLD_MS`    | no       | `1800000`                 | How long an unpaid hold lasts. 30 minutes, or until the event starts, whichever is sooner.                  |
| `AUTH_RATE_LIMIT`        | no       | `10`                      | Login and register requests allowed per client address per window.                                           |
| `AUTH_RATE_TTL_MS`       | no       | `60000`                   | Length of that window.                                                                                       |
| `BOOKING_RATE_LIMIT`     | no       | `30`                      | Reserve, pay, and cancel requests allowed per customer per window.                                           |
| `BOOKING_RATE_TTL_MS`    | no       | `60000`                   | Length of that window.                                                                                       |
| `MAX_ACTIVE_TICKETS_PER_EVENT` | no | `10`                   | Tickets one customer may hold or have paid for on a single event.                                            |
| `RATE_LIMIT_STORE`       | no       | `memory`                  | `memory` counts inside this process. `redis` shares that counter across API instances.                        |
| `REDIS_URL`              | if redis |                           | Required when `RATE_LIMIT_STORE` is `redis`. Example: `redis://localhost:6379`.                               |
| `ADMIN_EMAIL`            | no       | `admin@mobiversite.local` | Seed only. Not read by the HTTP process.                                                                      |
| `ADMIN_PASSWORD`         | no       | `change-me-admin`         | Seed only.                                                                                                    |

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

1. Register a customer with `POST /auth/register`. The password must be 12 to 128 characters. The email is trimmed and stored in lowercase. A duplicate email returns 409, including a different capitalization of the same address. The response has no password hash. Login and register are limited to 10 requests per minute per client address. The 11th returns 429.
2. `POST /auth/login` returns a bearer token. `GET /auth/me` returns the user for that token. A token whose user row has been deleted is rejected, because every authenticated request loads the user from MySQL.
3. As the admin, `POST /events` creates an event. `startsAt` must be in the future. `ticketPrice` is a non-negative number with at most two decimal places, up to `99999999.99`. `totalTickets` is an integer from 1 to `2147483647`. `availableTickets` starts equal to `totalTickets`.
4. As the customer, `GET /events` lists events that are still on sale and have not started yet, soonest first. Pass `from` and `to` (ISO-8601 instants, inclusive) to choose a different window, including events that already started. `q` matches a case-insensitive substring of the title. `GET /events/:id` returns one event that is still on sale.
5. `POST /bookings` with `{ "eventId", "quantity" }` holds tickets. `quantity` is 1 to 10, and one customer can have at most 10 active tickets (`HELD` or `PAID`) on the same event. The hold stores the ticket price at that moment, so a later price change does not rewrite the booking. The response status is `HELD`. `expiresAt` is 30 minutes ahead, or the event start, whichever comes first. Reserve, pay, and cancel are limited to 30 requests per minute per customer.
6. Send the header `Idempotency-Key` on that POST when the client might retry. The same customer, the same key, and the same body return the original booking. The same key with a different `eventId` or `quantity` returns 409. Another customer may reuse the same key. The key is 1 to 255 characters from letters, digits, `.`, `_`, `:`, and `-`.
7. `POST /bookings/:id/payment` calls the payment service. `{ "paid": true }` moves the booking to `PAID`. `{ "paid": false }`, or a declined HTTP status, leaves the hold in place and returns 409. Send `x-mock-payment: decline` to force that refusal. A later attempt uses a new idempotency key, so the customer can try again until the hold expires. Each attempt is stored. If the process dies after the provider accepts the charge, a job asks `GET /payments/:key` and either marks the booking paid or refunds it.
8. `POST /bookings/:id/cancel` on a hold returns the tickets and sets `CANCELLED`. On a paid booking it refunds first, then sets `REFUNDED` and returns the tickets. A paid booking cannot be cancelled after `startsAt`.
9. `GET /bookings` and `GET /bookings/:id` return only the caller's reservations, newest first. A hold whose `expiresAt` has passed is shown as `EXPIRED` even if the background job has not written that status yet.
10. An admin replaces an event with `PUT /events/:id` (every field is required) or hides it with `DELETE /events/:id`. Delete closes sales first, so a new hold cannot land while refunds are in progress. It then cancels unpaid holds, refunds paid bookings, and sets `deleted_at`. The row stays in the database. A hidden event disappears from the catalog and cannot be booked. Repeating the delete returns 404. `GET /events/:id/bookings` still lists the reservations after the event is hidden.
11. `GET /events/:id/bookings` lists every reservation for that event and includes the customer email. Customers receive 403.

List responses look like `{ "items": [...], "nextCursor": "..." }`. Pass `nextCursor` back as the `cursor` query parameter. `limit` defaults to 20 and must be from 1 to 100. A bad cursor returns 400.

Role rules are enforced on the route, not only in the UI. A customer who calls an admin route receives 403. An admin who calls a booking route receives 403. A missing or invalid token receives 401.

### Payment mock

`mock-payment/server.mjs` is a small Node process with no dependencies. It is an ES module, so `node mock-payment/server.mjs` works from this repository.

| Request                                                                        | Behavior                                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `GET /health`                                                                  | `{ "status": "ok" }`                                                                 |
| `GET /payments/:idempotencyKey`                                                | The stored result, or 404 when that key was never charged                            |
| `POST /payments`                                                               | `{ "paid": true }` with status 200                                                   |
| `POST /payments` plus header `x-mock-payment: decline`                         | `{ "paid": false }` with status 402. The same key repeats that decline. A new key is a new attempt. |
| `POST /payments` again with the same `Idempotency-Key`                         | The first result, with the original status, and no second charge                     |
| `POST /refunds` with `{ "bookingId", "amount" }`                               | `{ "refunded": true }`. A later payment for that booking is treated as a new charge. |

The API sends `Idempotency-Key` itself. The first attempt uses the booking id. A retry after a decline uses a new key. You do not set that header on the payment route. Send `x-mock-payment: decline` on `POST /bookings/:id/payment` when you want the mock to refuse.

## Architecture

The code is grouped by feature. Each feature is a Nest module with a controller, a service, and request or response types.

```
src/
  auth/         registration, login, JWT, roles
  rate-limit/   memory or Redis counters for login and bookings
  events/       catalog reads and admin writes
  bookings/     holds, payment, cancellation, expiry cron
  inventory/    row lock and return of expired holds
  payment/      PaymentGateway port and the HTTP adapter
  common/       cursor pagination, Prisma error filter, request log
  config/       environment schema, validation pipe, OpenAPI, helmet
  health/       database and rate-limit checks
  prisma/       shared Prisma client
prisma/         schema, migrations, seed
mock-payment/   payment double used by Compose
database/       SQL dump for reviewers
```

`EventsModule` calls `BookingsService` when an event is deleted, and both call `InventoryService` for locks. `BookingsService` does not depend on the events module. The payment HTTP client is behind the `PAYMENT_GATEWAY` injection token, so tests replace the whole gateway without starting a server.

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

The sweep is batched (200 events) and each event is committed on its own, so one failure does not roll back the others. Reads treat a `HELD` row past `expiresAt` as `EXPIRED` without writing, which keeps `GET /bookings` honest if the cron is late. The inventory count stays low until a write path or the cron actually returns the tickets. That split is deliberate: a read should not take a row lock.

### Payment outside the transaction

The payment HTTP call happens after the hold is known to be valid and before the status update commits. The event row is not locked while the mock is on the network. Locking it for the whole round trip would stall every other buyer of that event.

Before that call the API writes a `payment_attempts` row. The provider key is the booking id for the first attempt and `bookingId:2`, `bookingId:3`, and so on after a decline. If the process dies after the provider accepts the charge, the row stays `PENDING`. Once a minute the API asks `GET /payments/:key`. A stored payment is applied, or refunded when the hold can no longer be paid. An unknown key is marked declined so the customer can try again. A second pay request for the same booking waits if an attempt is still in flight.

That leaves a smaller gap. The mock can say paid, and then the hold can expire or be cancelled before the status update. The API then calls `/refunds` and leaves the attempt `REFUND_DUE` if that call fails, so the next pass retries it. If another request already committed `PAID`, the loser does not refund. The winner keeps the ticket and the single charge.

### Price snapshot and soft delete

`bookings.ticket_price` is copied from the event at reserve time. The amount sent to the payment service is that snapshot times `quantity`. Editing the event price later changes what a new hold will pay, not what an existing hold will pay.

Deleting an event sets `deleted_at` instead of removing the row. Reservations still point at a real event, and the catalog query is `deleted_at IS NULL` ordered by `starts_at, id`. The index `(deleted_at, starts_at, id)` matches that query. Paid reservations are refunded before the event is hidden. If a new paid booking appears in the gap, delete returns 409 and the admin retries.

### Authentication

Access tokens carry the user id, email, and role, and they expire. The JWT strategy still loads the user on each request so a deleted account stops working immediately and a role change is visible without waiting for the token to expire.

Login always runs a bcrypt compare. When the email does not exist, it compares against a dummy hash so the response time does not reveal which emails are registered. The error message is the same for a wrong password and an unknown email.

Registration does not accept a `role` field. Extra properties are rejected (`forbidNonWhitelisted`).

Login and register are rate limited. `RATE_LIMIT_STORE=memory` (the default) keeps the counter in this process. That is the right setting for one instance and for the test suite. `RATE_LIMIT_STORE=redis` with `REDIS_URL` stores the same counter in Redis, so a load balancer cannot multiply the login budget by the number of API containers. The Redis path is a fixed window: the first hit starts the TTL, the request past the limit is blocked for that window, and later hits in the block do not increment the counter. Both keys share a Redis hash tag, so they stay on one slot if the store is later moved to a cluster. Compose runs this Redis store. Express `trust proxy` is 1, so the limiter sees the client in front of a single proxy hop. If Redis is unreachable, login and register return an error. A down limiter must not turn into an open login route.

Passwords are hashed with bcrypt at 12 rounds. The dummy hash used for unknown emails is created once per process.

### Other decisions

- **UUID v7 primary keys.** Time-ordered identifiers, stored as `CHAR(36)`.
- **Cursor pagination.** Offset pages drift when rows are inserted at the top of a newest-first list. The cursor is the last row's sort time plus id, encoded as URL-safe base64.
- **Decimal money as strings.** Prices travel as `"25.00"` so JSON numbers do not round currency.
- **Helmet and CORS.** Security headers are on. Content Security Policy is off so the Swagger UI can load. CORS allows browser clients during review.
- **Prisma errors.** A unique-constraint failure becomes 409, a missing record 404, and a check-constraint or overflow failure 400. Other database failures become a generic 500 without the SQL text.
- **Request log.** Method, path, status, and duration, written when the response finishes, so a 404 is not logged as 200. Bodies are not logged, so passwords stay out of the log.
- **Health.** `GET /health` is public and checks the database. When the rate-limit store is Redis, it also pings Redis. Compose and orchestrators use it.

## Database

The Prisma schema is `prisma/schema.prisma`. The tables are `users`, `events`, `bookings`, and `payment_attempts`.

`users` has `email` (unique), `password_hash`, and `role` (`CUSTOMER` or `ADMIN`).

`events` has the public fields (`title`, `description`, `venue`, `starts_at`, `ticket_price`, `total_tickets`, `available_tickets`) plus `deleted_at` and `sales_closed_at`. Sales close before refunds run, so a delete cannot race a new hold. The catalog index is `(deleted_at, sales_closed_at, starts_at, id)`.

`bookings` has `user_id`, `event_id`, `quantity`, `status` (`HELD`, `PAID`, `CANCELLED`, `EXPIRED`, `REFUNDED`), a price snapshot, `expires_at`, and an optional idempotency key with a hash of the request body. The unique key is `(user_id, idempotency_key)`. MySQL allows many rows with a null key, so bookings that omit the header do not collide. The hot indexes are `(event_id, status, expires_at)` for expiry and `(event_id, created_at, id)` for the admin list.

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

`database/mobiversite.sql` is a snapshot of the schema, the Prisma migration history, the seeded admin, and the sample event. The running app does not load this file. It applies `prisma/migrations` on startup. Import the dump when you want the schema without running the API. Importing it and then running migrations is safe: the `_prisma_migrations` rows match the files in the repository, so `migrate deploy` does nothing.

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

| Script                      | What it does                                            |
| --------------------------- | ------------------------------------------------------- |
| `npm run start:dev`         | Generate the client and start Nest in watch mode.       |
| `npm run start:prod`        | Run `node dist/main` after `npm run build`.             |
| `npm run build`             | Generate the client and compile to `dist`.              |
| `npm run db:seed`           | Upsert the admin and the sample event. Requires `dist`. |
| `npm run ci`                | The same checks CI runs before the end-to-end suite.    |
| `npx prisma migrate deploy` | Apply pending migrations.                               |
| `npx prisma studio`         | Optional table browser against `DATABASE_URL`.          |
| `npm run prepare`           | Point Git at the Husky hooks. `npm ci` already does this. |

## Release

Pushing a version tag that starts with `v` builds this Dockerfile and publishes it to GitHub Container Registry. The tag has to be a semantic version, for example `v0.0.1`.

macOS, Linux, and Git Bash:

```bash
git tag v0.0.1
git push origin v0.0.1
```

Windows PowerShell and Command Prompt use the same two commands.

The workflow is `.github/workflows/release.yml`. It logs in with the workflow's `GITHUB_TOKEN` and pushes three tags. `OWNER/REPO` is the GitHub repository name, lowercased:

| Image                      | When                              |
| -------------------------- | --------------------------------- |
| `ghcr.io/OWNER/REPO:0.0.1` | The tag, without the leading `v`. |
| `ghcr.io/OWNER/REPO:0.0`   | The major.minor line.             |
| `ghcr.io/OWNER/REPO:latest` | Each successful release.         |

The package is private until its visibility is changed under the repository's Packages page. Pulling a private package needs `docker login ghcr.io` with a GitHub token that can read packages.

## Troubleshooting

| Symptom                                                | What to check                                                                                                                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose up` fails on the build                 | Docker is running, and the first build has network access to the npm registry.                                                                                                |
| API container restarts                                 | `docker compose logs api`. A production `JWT_SECRET` shorter than 32 characters, or a MySQL that is not ready, is the usual cause. Migrations run before the process listens. |
| `ECONNREFUSED 127.0.0.1:3306` from `npm run start:dev` | MySQL is not published on the host. Start it with `docker compose up mysql`.                                                                                                  |
| `P1001` or migrate cannot connect                      | `DATABASE_URL` host is `localhost` on the host and `mysql` inside Compose. The example file and `compose.yml` already differ in that way.                                     |
| Port already allocated                                 | Another process owns 3000, 3306, 4000, or 6379.                                                                                                                               |
| Login returns 500 and the log mentions Redis          | `RATE_LIMIT_STORE` is `redis` and `REDIS_URL` is wrong, or Redis is down. Compose sets both. A local process can stay on `memory`. Health then returns 503. |
| Register returns 429                                   | The auth limit is 10 requests per minute. Wait, or raise `AUTH_RATE_LIMIT`.                                                                                                   |
| Payment returns 502                                    | The mock is down, or `PAYMENT_SERVICE_URL` is wrong. From the host it must be `localhost`, not the Compose hostname `payment`.                                                |
| Seed says `Build the project before seeding`           | Run `npm run build` first.                                                                                                                                                    |
| Admin login fails after a volume reset                 | The seed runs on API startup. If you imported the SQL dump instead, the password is still `change-me-admin`.                                                                  |
| Windows `curl` posts the wrong body                    | You hit PowerShell's `curl` alias. Use `curl.exe`.                                                                                                                            |
