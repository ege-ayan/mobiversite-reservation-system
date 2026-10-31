import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const payments = new Map();
const webhookUrl = process.env.PAYMENT_WEBHOOK_URL;
const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;

const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        write(response, 400, { paid: false, refunded: false });
        return;
      }
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (request.method === 'GET' && url.pathname === '/health') {
      write(response, 200, { status: 'ok' });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/payments/')) {
      const key = decodeURIComponent(url.pathname.slice('/payments/'.length));
      const stored = key ? payments.get(key) : undefined;
      if (!stored) {
        write(response, 404, { paid: false });
        return;
      }
      write(response, 200, { paid: stored.paid });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/payments') {
      handlePayment(request, response, body);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/refunds') {
      if (!body.bookingId) {
        write(response, 400, { refunded: false });
        return;
      }
      forget(body.bookingId);
      write(response, 200, { refunded: true });
      return;
    }

    write(response, 404, { paid: false, refunded: false });
  });
});

server.listen(4000, '0.0.0.0');

function handlePayment(request, response, body) {
  const key = header(request, 'idempotency-key') || body.bookingId;
  if (key && payments.has(key)) {
    const stored = payments.get(key);
    write(response, stored.paid ? 200 : 402, { paid: stored.paid });
    return;
  }

  const decision = header(request, 'x-mock-payment');
  if (decision === 'error') {
    write(response, 500, { paid: false });
    return;
  }
  if (decision === 'timeout') {
    const result = remember(key, body, true);
    setTimeout(() => {
      notify(key, result, body);
      write(response, 200, { paid: true });
    }, 8_000);
    return;
  }
  if (decision === 'slow') {
    const result = remember(key, body, true);
    setTimeout(() => {
      notify(key, result, body);
      write(response, 200, { paid: true });
    }, 2_000);
    return;
  }
  if (decision === 'error-after-charge') {
    const result = remember(key, body, true);
    notify(key, result, body);
    write(response, 500, { paid: false });
    return;
  }

  const declined = decision === 'decline' || body.decline === true;
  const result = remember(key, body, !declined);
  notify(key, result, body);
  write(response, result.paid ? 200 : 402, { paid: result.paid });
}

function remember(key, body, paid) {
  const result = { paid, bookingId: body.bookingId, amount: body.amount };
  if (key) {
    payments.set(key, result);
  }
  return result;
}

function notify(key, result, body) {
  if (!webhookUrl || !webhookSecret || !key) {
    return;
  }
  const payload = JSON.stringify({
    idempotencyKey: key,
    bookingId: body.bookingId ?? null,
    amount: body.amount ?? null,
    paid: result.paid,
  });
  const signature = createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex');
  fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-payment-signature': signature,
    },
    body: payload,
  }).catch(() => undefined);
}

function forget(bookingId) {
  for (const key of payments.keys()) {
    if (key === bookingId || key.startsWith(`${bookingId}:`)) {
      payments.delete(key);
    }
  }
}

function header(request, name) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function write(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
