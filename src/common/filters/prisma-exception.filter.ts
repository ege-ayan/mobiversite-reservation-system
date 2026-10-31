import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';

import { ErrorCode } from '@/common/errors/error-code.js';
import { Prisma } from '@/generated/prisma/client.js';
import { isDatabaseBusy } from '@/prisma/retry.js';

type ErrorBody = {
  message: string | string[];
  error: string;
  statusCode: number;
  code: string;
  requestId?: string;
};

type HttpArgumentHost = {
  getResponse?: () => {
    status: (code: number) => { json: (body: ErrorBody) => void };
  };
  getRequest?: () => { id?: unknown };
};

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp() as HttpArgumentHost;
    const response = http.getResponse?.();
    if (!response) {
      throw exception;
    }
    const body = toErrorBody(exception);
    const requestId = http.getRequest?.()?.id;
    if (typeof requestId === 'string' && requestId.length > 0) {
      body.requestId = requestId;
    }
    if (
      process.env.NODE_ENV !== 'test' &&
      !isPrismaError(exception) &&
      !(exception instanceof HttpException)
    ) {
      this.logger.error(
        'Unhandled exception',
        exception instanceof Error ? exception.stack : undefined,
      );
    }
    response.status(body.statusCode).json(body);
  }
}

export function toErrorBody(exception: unknown): ErrorBody {
  if (isPrismaError(exception)) {
    return fromPrisma(exception);
  }
  if (exception instanceof HttpException) {
    return fromHttp(exception);
  }
  return {
    message: 'Internal server error',
    error: 'Internal Server Error',
    statusCode: 500,
    code: ErrorCode.INTERNAL_ERROR,
  };
}

function fromPrisma(
  exception:
    | Prisma.PrismaClientKnownRequestError
    | Prisma.PrismaClientUnknownRequestError,
): ErrorBody {
  if (
    exception instanceof Prisma.PrismaClientKnownRequestError &&
    exception.code === 'P2002'
  ) {
    return {
      message: 'Unique constraint failed',
      error: 'Conflict',
      statusCode: 409,
      code: ErrorCode.UNIQUE_CONFLICT,
    };
  }
  if (
    exception instanceof Prisma.PrismaClientKnownRequestError &&
    exception.code === 'P2025'
  ) {
    return {
      message: 'Record not found',
      error: 'Not Found',
      statusCode: 404,
      code: ErrorCode.NOT_FOUND,
    };
  }
  if (isDatabaseBusy(exception)) {
    return {
      message: 'The database is busy, try again',
      error: 'Service Unavailable',
      statusCode: 503,
      code: ErrorCode.DATABASE_BUSY,
    };
  }
  if (/check constraint|out of range|data truncated/i.test(exception.message)) {
    return {
      message: 'Request is outside the values the database can store',
      error: 'Bad Request',
      statusCode: 400,
      code: ErrorCode.INVALID_DATA,
    };
  }
  return {
    message: 'Unexpected database error',
    error: 'Internal Server Error',
    statusCode: 500,
    code: ErrorCode.DATABASE_ERROR,
  };
}

function fromHttp(exception: HttpException): ErrorBody {
  const statusCode = exception.getStatus();
  const raw = exception.getResponse();
  if (typeof raw === 'string') {
    return {
      message: raw,
      error: errorName(statusCode),
      statusCode,
      code: codeFor(statusCode, raw),
    };
  }
  if (Array.isArray(raw)) {
    const message = raw.map(String);
    return {
      message,
      error: errorName(statusCode),
      statusCode,
      code: codeFor(statusCode, message),
    };
  }
  const body = raw as {
    message?: string | string[];
    error?: string;
    code?: string;
  };
  const message = body.message ?? exception.message;
  return {
    message,
    error: body.error ?? errorName(statusCode),
    statusCode,
    code:
      typeof body.code === 'string' ? body.code : codeFor(statusCode, message),
  };
}

function codeFor(statusCode: number, message: string | string[]): ErrorCode {
  if (statusCode === 400 && Array.isArray(message)) {
    return ErrorCode.VALIDATION_ERROR;
  }
  switch (statusCode) {
    case 400:
      return ErrorCode.BAD_REQUEST;
    case 401:
      return ErrorCode.UNAUTHORIZED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 429:
      return ErrorCode.RATE_LIMITED;
    case 502:
      return ErrorCode.BAD_GATEWAY;
    case 503:
      return ErrorCode.SERVICE_UNAVAILABLE;
    default:
      return ErrorCode.HTTP_ERROR;
  }
}

function errorName(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'Bad Request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not Found';
    case 409:
      return 'Conflict';
    case 429:
      return 'Too Many Requests';
    case 502:
      return 'Bad Gateway';
    case 503:
      return 'Service Unavailable';
    default:
      return 'Error';
  }
}

function isPrismaError(
  exception: unknown,
): exception is
  | Prisma.PrismaClientKnownRequestError
  | Prisma.PrismaClientUnknownRequestError {
  return (
    exception instanceof Prisma.PrismaClientKnownRequestError ||
    exception instanceof Prisma.PrismaClientUnknownRequestError
  );
}
