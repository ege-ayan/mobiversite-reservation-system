import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

function body(
  statusCode: number,
  error: string,
  message: string,
  code: string,
) {
  return { statusCode, message, error, code };
}

export function badRequest(message: string, code: string) {
  return new BadRequestException(body(400, 'Bad Request', message, code));
}

export function unauthorized(message: string, code: string) {
  return new UnauthorizedException(body(401, 'Unauthorized', message, code));
}

export function forbidden(message: string, code: string) {
  return new ForbiddenException(body(403, 'Forbidden', message, code));
}

export function notFound(message: string, code: string) {
  return new NotFoundException(body(404, 'Not Found', message, code));
}

export function conflict(message: string, code: string) {
  return new ConflictException(body(409, 'Conflict', message, code));
}

export function badGateway(message: string, code: string) {
  return new BadGatewayException(body(502, 'Bad Gateway', message, code));
}
