import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, tap } from 'rxjs';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<{
      method: string;
      url: string;
    }>();
    const response = context
      .switchToHttp()
      .getResponse<{ statusCode: number }>();
    const started = Date.now();
    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(this.format(request, response.statusCode, started));
        },
        error: () => {
          this.logger.warn(this.format(request, response.statusCode, started));
        },
      }),
    );
  }

  private format(
    request: { method: string; url: string },
    statusCode: number,
    started: number,
  ): string {
    return `${request.method} ${request.url} ${statusCode} ${Date.now() - started}ms`;
  }
}
