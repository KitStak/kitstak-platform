/** The people reads of the bridge (SPEC 8.1): empty without the schema, never throw, system DTOs carry no pay or private field. */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { countBillablePeople, getPeopleForWmsUsers, type BridgeExecutor, type CrewPersonRef } from './index';

const ORG = '11111111-1111-4111-8111-111111111111';
const dialect = new PgDialect();

function fakeDb(handlers: readonly [RegExp, (params: unknown[]) => unknown[]][], log: string[] = []): BridgeExecutor {
  return {
    async execute(statement: SQL) {
      const { sql, params } = dialect.sqlToQuery(statement);
      log.push(sql);
      for (const [pattern, answer] of handlers) if (pattern.test(sql)) return { rows: answer(params) };
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
}
const installed = (yes: boolean): [RegExp, () => unknown[]] => [/to_regclass\('crew\.people'\)/, () => [{ installed: yes }]];
const failing = (pattern: RegExp): [RegExp, () => unknown[]] => [
  pattern,
  () => {
    throw new Error('down');
  },
];

/** Field names that must never appear in a system read (SPEC 3.3). */
const FORBIDDEN = /wage|pay|salary|exempt|emergency|address|phone|email|private|notes|attendance|late|no_call/i;

function walkKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => walkKeys(item, out));
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      out.push(key);
      walkKeys(inner, out);
    }
  }
  return out;
}

describe('countBillablePeople (SPEC 8.1)', () => {
  it('is 0 without the schema, for a bad org or date, and on any error', async () => {
    expect(await countBillablePeople(fakeDb([installed(false)]), { orgId: ORG, onDate: '2026-11-27' })).toBe(0);
    expect(await countBillablePeople(fakeDb([installed(true)]), { orgId: 'nope', onDate: '2026-11-27' })).toBe(0);
    expect(await countBillablePeople(fakeDb([installed(true)]), { orgId: ORG, onDate: '27/11/2026' })).toBe(0);
    expect(await countBillablePeople(fakeDb([installed(true), failing(/count/)]), { orgId: ORG, onDate: '2026-11-27' })).toBe(0);
  });

  it('counts active people on the date, temps included', async () => {
    const log: string[] = [];
    const db = fakeDb([installed(true), [/count\(\*\)/, (params) => (params.includes('2026-11-27') ? [{ n: '31' }] : [])]], log);
    expect(await countBillablePeople(db, { orgId: ORG, onDate: '2026-11-27' })).toBe(31);
    expect(log.at(-1)).toMatch(/status = 'active'/);
    expect(log.at(-1)).not.toMatch(/kind/);
  });
});

describe('getPeopleForWmsUsers (SPEC 8.4)', () => {
  it('is empty without ids, without the schema and on any error', async () => {
    expect(await getPeopleForWmsUsers(fakeDb([installed(true)]), { orgId: ORG, wmsUserIds: [] })).toEqual([]);
    expect(await getPeopleForWmsUsers(fakeDb([installed(false)]), { orgId: ORG, wmsUserIds: ['u1'] })).toEqual([]);
    expect(await getPeopleForWmsUsers(fakeDb([installed(true), failing(/crew\.people p/)]), { orgId: ORG, wmsUserIds: ['u1'] })).toEqual([]);
  });

  it('returns names, numbers and sites only: the DTO walk finds no pay, private or attendance field', async () => {
    const db = fakeDb([
      installed(true),
      [/crew\.people p/, () => [{ person_id: 'p1', number: 'T-1001', first_name: 'Maria', last_name: 'Lopez', preferred_name: null, kind: 'temp', status: 'active', site_id: 's1', site_name: 'MLT1', wms_user_id: 'u1', wage_cents: 1950, emergency_phone: '555' }]],
    ]);
    const found: CrewPersonRef[] = await getPeopleForWmsUsers(db, { orgId: ORG, wmsUserIds: ['u1', 'u1'] });
    expect(found).toEqual([{ personId: 'p1', number: 'T-1001', name: 'Maria Lopez', kind: 'temp', status: 'active', siteId: 's1', siteName: 'MLT1', wmsUserId: 'u1' }]);
    expect(walkKeys(found).filter((key) => FORBIDDEN.test(key))).toEqual([]);
    expect(JSON.stringify(found)).not.toMatch(/[$€£]\s?\d/);
  });
});
