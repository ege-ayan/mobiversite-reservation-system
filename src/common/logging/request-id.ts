import { randomUUID } from 'node:crypto';

const REQUEST_ID = /^[\w.-]{1,200}$/;

export function requestIdFromHeader(
  header: string | string[] | undefined,
): string {
  if (typeof header === 'string' && REQUEST_ID.test(header)) {
    return header;
  }
  return randomUUID();
}
