/**
 * Kind filters with and without `pm.projects.kind` (docs/programs/SPEC.md 4.1, 6.5): a database
 * older than Projects 0006 gets the old SQL (no kind column named anywhere) and program reads
 * answer `not_installed`; a migrated one keeps programs and builds out of project reads.
 */
import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { listLinkedPrograms, listProgramsForKit, newProgramUrl, programUrl } from './programs';
import { countLinkedWork, listLinkedWork, listWritableProjects } from './read';
import type { BridgeExecutor } from './executor';

const dialect = new PgDialect();
const ORG = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';
const ACCOUNT = '00000000-0000-4000-8000-000000000003';

function fakeDb(kinds: boolean): { db: BridgeExecutor; statements: string[] } {
  const statements: string[] = [];
  const db: BridgeExecutor = {
    async execute(query: SQL) {
      const text = dialect.sqlToQuery(query).sql;
      if (text.includes('as installed')) return { rows: [{ installed: true, events: true, kinds, programs: kinds }] };
      if (text.includes('from core.member')) return { rows: [{ role: 'owner' }] };
      statements.push(text);
      return { rows: [] };
    },
    transaction: (fn) => fn(db),
  };
  return { db, statements };
}

describe('kind filters', () => {
  it('reads the old way on a database without pm.projects.kind', async () => {
    const { db, statements } = fakeDb(false);
    await listWritableProjects(db, { orgId: ORG, userId: USER });
    await listLinkedWork(db, { orgId: ORG, userId: USER }, [{ type: 'crm_account', id: ACCOUNT }], { projectsUrl: 'https://p.example' });
    await countLinkedWork(db, { orgId: ORG, userId: USER }, 'crm_account', [ACCOUNT]);
    expect(statements.length).toBeGreaterThan(2);
    for (const text of statements) expect(text).not.toMatch(/\.kind\b/);
    expect(await listLinkedPrograms(db, { orgId: ORG, userId: USER }, [{ type: 'crm_account', id: ACCOUNT }], { projectsUrl: 'https://p.example' })).toEqual({ available: false, reason: 'not_installed' });
    expect(await listProgramsForKit(db, { orgId: ORG, userId: USER }, { wmsProductId: 'P1' }, { projectsUrl: 'https://p.example' })).toEqual({ available: false, reason: 'not_installed' });
  });

  it('keeps programs and builds out of project reads once the column exists', async () => {
    const { db, statements } = fakeDb(true);
    await listWritableProjects(db, { orgId: ORG, userId: USER });
    await countLinkedWork(db, { orgId: ORG, userId: USER }, 'crm_account', [ACCOUNT]);
    const joined = statements.join('\n');
    expect(joined).toContain("p.kind = 'project'");
    expect(joined).toContain("t.kind = 'task'");
  });
});

describe('program urls', () => {
  it('links to the program and to the wizard started from a deal', () => {
    expect(programUrl({ projectsUrl: 'https://projects.example/' }, 'GLOVE')).toBe('https://projects.example/programs/GLOVE');
    expect(newProgramUrl({ projectsUrl: 'https://projects.example' }, { crmItem: ACCOUNT, name: 'Glove kitting program' })).toBe(
      `https://projects.example/programs/new?crmItem=${ACCOUNT}&name=Glove+kitting+program`,
    );
    expect(newProgramUrl({ projectsUrl: 'https://projects.example' }, {})).toBe('https://projects.example/programs/new');
  });
});
