import { createServer } from 'node:http';

const payments = new Map();

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
      write(response, 200, stored);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/payments') {
      const key = header(request, 'idempotency-key') || body.bookingId;
      if (key && payments.has(key)) {
        const stored = payments.get(key);
        write(response, stored.paid ? 200 : 402, stored);
        return;
      }
      const declined =
        header(request, 'x-mock-payment') === 'decline' || body.decline === true;
      const result = { paid: !declined };
      if (key) {
        payments.set(key, result);
      }
      write(response, result.paid ? 200 : 402, result);
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
