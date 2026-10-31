import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(request: Request, response: Response, next: NextFunction): void {
    const started = Date.now();
    response.on('finish', () => {
      const line = `${request.method} ${request.originalUrl} ${response.statusCode} ${Date.now() - started}ms`;
      if (response.statusCode >= 500) {
        this.logger.error(line);
        return;
      }
      if (response.statusCode >= 400) {
        this.logger.warn(line);
        return;
      }
      this.logger.log(line);
    });
    next();
  }
}
