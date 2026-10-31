import { requestIdFromHeader } from './request-id.js';

describe('requestIdFromHeader', () => {
  it('keeps a caller supplied request id', () => {
    expect(requestIdFromHeader('req-1')).toBe('req-1');
  });

  it('ignores a header that is not a single safe token', () => {
    expect(requestIdFromHeader('not a token')).toEqual(expect.any(String));
    expect(requestIdFromHeader('not a token')).not.toBe('not a token');
    expect(requestIdFromHeader(['a', 'b'])).not.toBe('a');
  });
});
