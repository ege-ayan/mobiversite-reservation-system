import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor, slicePage } from './cursor.js';

const id = '01932a5e-8c3a-7c2e-9b1a-6d4f2e8c0a11';
const at = new Date('2026-12-01T18:00:00.000Z');

describe('cursor', () => {
  it('round-trips a page cursor', () => {
    const decoded = decodeCursor(encodeCursor(at, id));

    expect(decoded.id).toBe(id);
    expect(decoded.at.toISOString()).toBe(at.toISOString());
  });

  it('rejects a cursor that is not a page position', () => {
    const staleDate = Buffer.from(
      JSON.stringify({ at: 'not-a-date', id }),
      'utf8',
    ).toString('base64url');

    expect(() => decodeCursor('not-json')).toThrow(BadRequestException);
    expect(() => decodeCursor(encodeCursor(at, 'not-a-uuid'))).toThrow(
      BadRequestException,
    );
    expect(() => decodeCursor(staleDate)).toThrow('Invalid cursor');
  });

  it('keeps a cursor when another row remains', () => {
    const page = slicePage(
      [
        { id, at },
        { id: '01932a5e-8c3a-7c2e-9b1a-6d4f2e8c0a12', at },
      ],
      1,
      (row) => row.at,
    );

    expect(page.items).toEqual([{ id, at }]);
    expect(decodeCursor(page.nextCursor ?? '').id).toBe(id);
  });

  it('omits the cursor on the last page', () => {
    expect(slicePage([{ id, at }], 1, (row) => row.at).nextCursor).toBeNull();
  });
});
