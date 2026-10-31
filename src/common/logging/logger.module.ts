import type { IncomingMessage, ServerResponse } from 'node:http';

import { LoggerModule } from 'nestjs-pino';

import { requestIdFromHeader } from './request-id.js';

const QUIET_PATHS = new Set(['/health', '/health/live', '/health/ready']);

export function requestLogLevel(
  url: string | undefined,
  statusCode: number,
): 'info' | 'silent' {
  const path = url?.split('?')[0];
  if (
    path !== undefined &&
    QUIET_PATHS.has(path) &&
    statusCode >= 200 &&
    statusCode < 400
  ) {
    return 'silent';
  }
  return 'info';
}

export const loggerModule = LoggerModule.forRoot({
  pinoHttp: {
    level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
    genReqId: (request: IncomingMessage, response: ServerResponse) => {
      const id = requestIdFromHeader(request.headers['x-request-id']);
      response.setHeader('x-request-id', id);
      return id;
    },
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    customLogLevel: (request, response) =>
      requestLogLevel(request.url, response.statusCode),
  },
});
