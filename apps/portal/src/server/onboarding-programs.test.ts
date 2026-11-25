/**
 * The Projects card counts (docs/programs/SPEC.md 6.4): projects and programs are counted apart
 * once `pm.projects.kind` exists, and an older database counts every container as a project.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const state = vi.hoisted(() => ({ kinds: true, statements: [] as string[], counts: { projects: '9', programs: '4', assigned: '12', links: '3' } }));

vi.mock('server-only', () => ({}));
vi.mock('@/server/env', () => ({ env: {} }));
vi.mock('@/server/db', () => {
  const dialect = new PgDialect();
  return {
    db: {
      execute: async (query: SQL) => {
        const text = dialect.sqlToQuery(query).sql;
        state.statements.push(text);
        if (text.includes('as installed')) return { rows: [{ installed: true, kinds: state.kinds }] };
        return { rows: [state.counts] };
      },
    },
  };
});

describe('Projects card counts', () => {
  beforeEach(() => {
    state.statements = [];
  });

  it('counts projects and programs apart', async () => {
    state.kinds = true;
    const { getProjectsCardCounts } = await import('./onboarding');
    expect(await getProjectsCardCounts('00000000-0000-4000-8000-000000000001')).toEqual({ projects: 9, programs: 4, label: '9 projects · 4 programs' });
    expect(state.statements.join('\n')).toContain("p.kind = 'project'");
    expect(state.statements.join('\n')).toContain("t.kind = 'task'");
  });

  it('skips the kind filters on a database without the column', async () => {
    state.kinds = false;
    const { getProjectsCardCounts } = await import('./onboarding');
    await getProjectsCardCounts('00000000-0000-4000-8000-000000000001');
    expect(state.statements.slice(1).join('\n')).not.toMatch(/\.kind\b/);
  });

  it('writes the label in plain words', async () => {
    const { projectsCardLabel } = await import('./onboarding');
    expect(projectsCardLabel({ projects: 1, programs: 0 })).toBe('1 project');
    expect(projectsCardLabel({ projects: 0, programs: 1 })).toBe('1 program');
    expect(projectsCardLabel({ projects: 0, programs: 0 })).toBeNull();
  });
});
