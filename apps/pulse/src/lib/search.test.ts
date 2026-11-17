import { describe, expect, it } from 'vitest';
import { searchPulse } from './search';

const owner = { role: 'owner', seesMoney: true } as const;
const supervisor = { role: 'supervisor', seesMoney: false } as const;

describe('searchPulse', () => {
  it('returns nothing for an empty query', () => {
    expect(searchPulse('   ', owner)).toEqual([]);
  });

  it('finds pages, reports and data files', () => {
    const hits = searchPulse('labor', owner);
    expect(hits.map((hit) => hit.id)).toEqual(expect.arrayContaining(['labor', 'labor-summary', 'labor_rates']));
    const billing = searchPulse('ready bill', owner);
    expect(billing.filter((hit) => hit.kind === 'report').map((hit) => hit.id)).toEqual(['ready-to-bill']);
    expect(billing.filter((hit) => hit.kind === 'page').map((hit) => hit.id)).toEqual(['reports']);
  });

  it('needs every word to match', () => {
    expect(searchPulse('profit zebra', owner)).toEqual([]);
  });

  it('never shows a supervisor money pages, money reports or streams they cannot import', () => {
    const hits = searchPulse('profit', supervisor);
    expect(hits).toEqual([]);
    expect(searchPulse('production', supervisor).map((hit) => hit.id)).toEqual(['log', 'production']);
    expect(searchPulse('rates', supervisor).map((hit) => hit.id)).toEqual(['labor']);
  });

  it('gives nothing to people with no role', () => {
    expect(searchPulse('jobs', { role: 'none', seesMoney: false })).toEqual([]);
  });
});
