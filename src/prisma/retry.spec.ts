import { Prisma } from '../generated/prisma/client.js';
import { withDatabaseRetry } from './retry.js';

describe('withDatabaseRetry', () => {
  it('retries a deadlock and then returns the result', async () => {
    const work = vi
      .fn()
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('deadlock', {
          code: 'P2034',
          clientVersion: 'test',
        }),
      )
      .mockResolvedValueOnce('ok');

    await expect(withDatabaseRetry(work)).resolves.toBe('ok');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('does not retry an application error', async () => {
    const work = vi.fn().mockRejectedValue(new Error('sold out'));

    await expect(withDatabaseRetry(work)).rejects.toThrow('sold out');
    expect(work).toHaveBeenCalledOnce();
  });
});
