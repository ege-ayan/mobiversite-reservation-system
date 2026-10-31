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
    };
  }
  if (/check constraint|out of range|data truncated/i.test(exception.message)) {
    return {
      message: 'Request is outside the values the database can store',
      error: 'Bad Request',
      statusCode: 400,
    };
  }
  return {
    message: 'Unexpected database error',
    error: 'Internal Server Error',
    statusCode: 500,
  };
}
