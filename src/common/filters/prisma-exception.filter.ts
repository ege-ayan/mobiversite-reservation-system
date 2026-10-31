import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';

type ErrorBody = {
  message: string;
  error: string;
  statusCode: number;
  code: string;
};

@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientUnknownRequestError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(
    exception:
      | Prisma.PrismaClientKnownRequestError
      | Prisma.PrismaClientUnknownRequestError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<{
      status: (code: number) => { json: (body: ErrorBody) => void };
    }>();
    const body = toErrorBody(exception);
    response.status(body.statusCode).json(body);
  }
}

function toErrorBody(
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
      code: 'UNIQUE_CONFLICT',
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
      code: 'NOT_FOUND',
    };
  }
  if (isDatabaseBusy(exception)) {
    return {
      message: 'The database is busy, try again',
      error: 'Service Unavailable',
      statusCode: 503,
      code: 'DATABASE_BUSY',
    };
  }
  if (/check constraint|out of range|data truncated/i.test(exception.message)) {
    return {
      message: 'Request is outside the values the database can store',
      error: 'Bad Request',
      statusCode: 400,
      code: 'INVALID_DATA',
    };
  }
  return {
    message: 'Unexpected database error',
    error: 'Internal Server Error',
    statusCode: 500,
    code: 'DATABASE_ERROR',
  };
}

function isDatabaseBusy(
  exception:
    | Prisma.PrismaClientKnownRequestError
    | Prisma.PrismaClientUnknownRequestError,
): boolean {
  if (
    exception instanceof Prisma.PrismaClientKnownRequestError &&
    (exception.code === 'P2028' || exception.code === 'P2034')
  ) {
    return true;
  }
  return /deadlock|lock wait timeout/i.test(exception.message);
}
