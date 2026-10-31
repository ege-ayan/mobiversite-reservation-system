import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { requestIdFromHeader } from './request-id.js';

export const loggerModule = LoggerModule.forRoot({
  pinoHttp: {
    level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
    genReqId: (request: IncomingMessage, response: ServerResponse) => {
      const id = requestIdFromHeader(request.headers['x-request-id']);
      response.setHeader('x-request-id', id);
      return id;
    },
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    autoLogging: true,
  },
});
