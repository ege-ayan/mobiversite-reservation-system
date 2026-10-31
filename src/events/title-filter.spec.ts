import { titleFilter } from './title-filter.js';

describe('titleFilter', () => {
  it('quotes words so boolean operators are not executed', () => {
    expect(titleFilter(' live ')).toEqual({ title: { search: '"live"' } });
    expect(titleFilter('live(')).toEqual({ title: { search: '"live"' } });
    expect(titleFilter('mobiversite live')).toEqual({
      title: { search: '"mobiversite" "live"' },
    });
  });

  it('falls back to a substring when the search has no searchable word', () => {
    expect(titleFilter('+-~')).toEqual({ title: { contains: '+-~' } });
    expect(titleFilter('a)b')).toEqual({ title: { contains: 'a)b' } });
    expect(titleFilter('   ')).toEqual({});
  });
});
