const { createServer } = require('node:http');

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

    if (request.method === 'GET' && request.url === '/health') {
      write(response, 200, { status: 'ok' });
      return;
    }

    if (request.method === 'POST' && request.url === '/payments') {
      const key = header(request, 'idempotency-key') || body.bookingId;
      if (key && payments.has(key)) {
        write(response, 200, payments.get(key));
        return;
      }
      const declined = header(request, 'x-mock-payment') === 'decline';
      const result = { paid: !declined };
      if (key) {
        payments.set(key, result);
      }
      write(response, result.paid ? 200 : 402, result);
      return;
    }

    if (request.method === 'POST' && request.url === '/refunds') {
      if (!body.bookingId) {
        write(response, 400, { refunded: false });
        return;
      }
      payments.delete(body.bookingId);
      write(response, 200, { refunded: true });
      return;
    }

    write(response, 404, { paid: false, refunded: false });
  });
});

server.listen(4000, '0.0.0.0');

function header(request, name) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function write(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
