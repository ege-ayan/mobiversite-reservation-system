import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ApiPageQueries, PageQuery } from './page-query.js';

describe('PageQuery', () => {
  it('reads the page size from the query string', async () => {
    const query = plainToInstance(PageQuery, { limit: '20', cursor: 'abc' });

    expect(query.limit).toBe(20);
    await expect(validate(query)).resolves.toEqual([]);
  });

  it('rejects a page size outside 1 to 100', async () => {
    const query = plainToInstance(PageQuery, { limit: '101' });

    await expect(validate(query)).resolves.toHaveLength(1);
  });

  it('documents limit and cursor on a list route', () => {
    expect(ApiPageQueries()).toEqual(expect.any(Function));
  });
});
