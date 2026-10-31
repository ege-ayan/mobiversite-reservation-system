import { type ArgumentsHost } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { BadRequestException } from '@nestjs/common';
import { AppExceptionFilter } from './prisma-exception.filter.js';

describe('AppExceptionFilter', () => {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  const filter = new AppExceptionFilter();

  beforeEach(() => {
    json.mockReset();
    status.mockClear();
  });

  it('maps a unique constraint to a conflict', () => {
    filter.catch(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409 }),
    );
  });

  it('maps a check constraint to a bad request', () => {
    filter.catch(
      new Prisma.PrismaClientUnknownRequestError(
        'Check constraint events_available_tickets_check is violated',
        { clientVersion: 'test' },
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
  });

  it('maps a lock timeout to an unavailable response', () => {
    filter.catch(
      new Prisma.PrismaClientUnknownRequestError(
        'Lock wait timeout exceeded; try restarting transaction',
        { clientVersion: 'test' },
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'The database is busy, try again',
        statusCode: 503,
      }),
    );
  });

  it('hides an unexpected database error', () => {
    filter.catch(
      new Prisma.PrismaClientUnknownRequestError('connection reset', {
        clientVersion: 'test',
      }),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      message: 'Unexpected database error',
      error: 'Internal Server Error',
      statusCode: 500,
      code: 'DATABASE_ERROR',
    });
  });

  it('adds a code to a validation error', () => {
    filter.catch(new BadRequestException(['email must be an email']), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        message: ['email must be an email'],
      }),
    );
  });

  it('hides an unexpected error', () => {
    filter.catch(new Error('secret query'), host);

    expect(json).toHaveBeenCalledWith({
      message: 'Internal server error',
      error: 'Internal Server Error',
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
  });
});
