import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestLoggingMiddleware } from './request-logging.middleware.js';

describe('RequestLoggingMiddleware', () => {
  it('logs the status written by a later error handler', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const middleware = new RequestLoggingMiddleware();
    let finish: () => void = () => undefined;
    const response = {
      statusCode: 200,
      on: (event: string, listener: () => void) => {
        if (event === 'finish') {
          finish = listener;
        }
      },
    } as unknown as Response;

    middleware.use(
      { method: 'GET', originalUrl: '/events/missing' } as Request,
      response,
      (() => undefined) as NextFunction,
    );
    response.statusCode = 404;
    finish();

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^GET \/events\/missing 404 \d+ms$/),
    );
    warn.mockRestore();
  });
});
