import { describe, expect, it } from 'vitest';
import { aliasProductListParams } from '@/lib/grid-defs/products/list-query';
import { parseGridQuery } from '@/server/query/grid-query';

describe('aliasProductListParams', () => {
  it('maps Logiwa ?sku=&skuqt=eq&ps= to the grid grammar', () => {
    const q = parseGridQuery(aliasProductListParams(new URLSearchParams('sku=ABC&skuqt=eq&ps=300'))).query;
    expect(q.q).toBe('ABC');
    expect(q.qm).toBe('eq');
    expect(q.pageSize).toBe(300);
  });
  it('accepts search= and lets canonical q win', () => {
    expect(aliasProductListParams(new URLSearchParams('search=X')).get('q')).toBe('X');
    expect(aliasProductListParams(new URLSearchParams('q=A&search=B')).get('q')).toBe('A');
  });
  it('drops the alias keys', () => {
    const p = aliasProductListParams(new URLSearchParams('sku=A&skuqt=sw'));
    expect([...p.keys()].sort()).toEqual(['q', 'qm']);
  });
});
