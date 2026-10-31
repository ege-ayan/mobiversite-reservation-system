import { badRequest } from '../errors/app.exception.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PageCursor = {
  at: Date;
  id: string;
};

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ at: at.toISOString(), id }),
    'utf8',
  ).toString('base64url');
}

export function decodeCursor(value: string): PageCursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (!isCursor(parsed)) {
      throw new Error('invalid');
    }
    const at = new Date(parsed.at);
    if (Number.isNaN(at.getTime())) {
      throw new Error('invalid');
    }
    return { at, id: parsed.id };
  } catch {
    throw badRequest('Invalid cursor', 'INVALID_CURSOR');
  }
}

export function slicePage<T extends { id: string }>(
  rows: T[],
  limit: number,
  at: (row: T) => Date,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(at(last), last.id) : null,
  };
}

function isCursor(value: unknown): value is { at: string; id: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'at' in value &&
    'id' in value &&
    typeof value.at === 'string' &&
    typeof value.id === 'string' &&
    UUID.test(value.id)
  );
}
