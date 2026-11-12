import { describe, expect, it } from 'vitest';
import {
  parseFilter,
  parseGridQuery,
  serializeGridQuery,
  splitList,
  DEFAULT_PAGE_SIZE,
} from '@/server/query/grid-query';

describe('parseGridQuery', () => {
  it('returns defaults for an empty query', () => {
    const { query, issues } = parseGridQuery('');
    expect(issues).toEqual([]);
    expect(query).toEqual({ qm: 'sw', filters: [], sort: [], page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it('parses quick search, sort, paging and every operator', () => {
    const qs =
      'q=SO00&qm=eq&sort=-createdAt,code&page=3&ps=300' +
      '&f.status=in:Open,Shortage&f.channel=nin:Amazon&f.code=sw:SO&f.name=ct:wid&f.sku=ew:-01&f.ref=eq:X' +
      '&f.notes=ex&f.tags=empty:&f.qty=rng:10..50&f.isKit=bool:true&f.createdAt=date:last7d&f.shipBy=date:custom:2026-11-01..2026-11-05';
    const { query, issues } = parseGridQuery(qs);
    expect(issues).toEqual([]);
    expect(query.q).toBe('SO00');
    expect(query.qm).toBe('eq');
    expect(query.sort).toEqual([
      { field: 'createdAt', dir: 'desc' },
      { field: 'code', dir: 'asc' },
    ]);
    expect(query.page).toBe(3);
    expect(query.pageSize).toBe(300);
    expect(query.filters).toEqual([
      { field: 'status', op: 'in', values: ['Open', 'Shortage'] },
      { field: 'channel', op: 'nin', values: ['Amazon'] },
      { field: 'code', op: 'sw', value: 'SO' },
      { field: 'name', op: 'ct', value: 'wid' },
      { field: 'sku', op: 'ew', value: '-01' },
      { field: 'ref', op: 'eq', value: 'X' },
      { field: 'notes', op: 'ex' },
      { field: 'tags', op: 'empty' },
      { field: 'qty', op: 'rng', min: '10', max: '50' },
      { field: 'isKit', op: 'bool', value: true },
      { field: 'createdAt', op: 'date', date: { kind: 'fixed', preset: 'last7d' } },
      { field: 'shipBy', op: 'date', date: { kind: 'custom', from: '2026-11-01', to: '2026-11-05' } },
    ]);
  });

  it('reports invalid parts and drops them', () => {
    const { query, issues } = parseGridQuery(
      'qm=zz&ps=5000&page=0&sort=bad field&f.x=nope:1&f.1bad=eq:1&f.d=date:yesterday&f.b=bool:yes&f.r=rng:5',
    );
    expect(query.filters).toEqual([]);
    expect(query.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(issues.map((i) => i.param)).toEqual([
      'qm',
      'ps',
      'page',
      'sort',
      'f.x',
      'f.1bad',
      'f.d',
      'f.b',
      'f.r',
    ]);
  });

  it('accepts open ranges, relative presets and record input', () => {
    const { query } = parseGridQuery({
      'f.qty': ['rng:..9', 'rng:1..'],
      'f.due': 'date:withinNext3d',
      page: '2',
    });
    expect(query.filters).toEqual([
      { field: 'qty', op: 'rng', max: '9' },
      { field: 'qty', op: 'rng', min: '1' },
      { field: 'due', op: 'date', date: { kind: 'relative', preset: 'withinNext', days: 3 } },
    ]);
    expect(query.page).toBe(2);
  });

  it('dedupes sort fields and supports custom-field keys', () => {
    expect(parseGridQuery('sort=a,-a,cf.color').query.sort).toEqual([
      { field: 'a', dir: 'asc' },
      { field: 'cf.color', dir: 'asc' },
    ]);
  });

  it('rejects empty lists and missing values', () => {
    expect(parseFilter('status', 'in:')).toMatch(/at least one/);
    expect(parseFilter('code', 'sw:')).toMatch(/Enter a value/);
    expect(parseFilter('qty', 'rng:..')).toMatch(/minimum or a maximum/);
  });
});

describe('splitList', () => {
  it('splits on unescaped commas and trims', () => {
    expect(splitList(String.raw`a, b\,c ,,d`)).toEqual(['a', 'b,c', 'd']);
  });
});

describe('serializeGridQuery', () => {
  it('round-trips through parse', () => {
    const original =
      'q=abc&qm=eq&f.status=in:Open,A\,B&f.qty=rng:1..&f.created=date:custom:2026-01-01..&f.flag=bool:false&f.n=ex&sort=-createdAt,code&page=2&ps=500';
    const parsed = parseGridQuery(original).query;
    const serialized = serializeGridQuery(parsed);
    expect(parseGridQuery(serialized).query).toEqual(parsed);
  });

  it('omits defaults', () => {
    expect(
      serializeGridQuery({ qm: 'sw', page: 1, pageSize: DEFAULT_PAGE_SIZE, filters: [], sort: [] }),
    ).toBe('');
  });
});
