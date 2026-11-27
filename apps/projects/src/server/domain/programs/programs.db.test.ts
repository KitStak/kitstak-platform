/**
 * Program create, kind isolation and generic project mutations (docs/programs/SPEC.md 9.2).
 * Runs in a throwaway org on the program clock fixed at 2026-11-25 (America/Chicago).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from '../_shared';

const ready = await databaseReady(['pm.projects', 'pm.builds', 'pm.build_output', 'pm.program_ledger', 'core.record_links']);

describe.skipIf(!ready)('programs: create, isolation and guards', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let member: DomainContext;
  let programs: typeof import('./index');
  let projectsDomain: typeof import('../projects');
  let tasksDomain: typeof import('../tasks');
  let searchDomain: typeof import('../search');
  let programId = '';
  let projectId = '';

  beforeAll(async () => {
    programs = await import('./index');
    projectsDomain = await import('../projects');
    tasksDomain = await import('../tasks');
    searchDomain = await import('../search');
    programs.setProgramClock(() => new Date('2026-11-25T15:00:00Z'));
    org = await createTestOrg('programs-create');
    owner = await org.member('owner', 'Maya Owner');
    member = await org.member('member', 'Sam Member');
    await org.query(`insert into pm.org_calendar (org_id, timezone, working_days, holidays) values ($1, 'America/Chicago', '{1,2,3,4,5}', $2::jsonb)`, [org.orgId, JSON.stringify([{ date: '2026-11-26', name: 'Thanksgiving' }])]);
    const project = await projectsDomain.createProject(owner, { name: 'Frames', key: 'FRA' });
    projectId = project.id;
  });

  afterAll(async () => {
    programs?.resetProgramClock();
    await org?.destroy();
  });

  it('creates the program, its setup and one week of builds (Thanksgiving off)', async () => {
    const { createFixtureProgram } = await import('./fixture');
    const created = await createFixtureProgram(owner, { key: 'GLOVE', startDate: '2026-11-25' });
    expect(created.key).toBe('GLOVE');
    expect(created.url).toBe('/programs/GLOVE');
    expect(created.generated.builds).toBe(40);
    expect(created.generated.units).toBe('4000.000');
    expect(created.generated.through).toBe('2026-12-02');
    const [row] = await org.query<{ id: string; kind: string }>(`select id, kind from pm.projects where org_id = $1 and key = 'GLOVE'`, [org.orgId]);
    programId = row!.id;
    expect(row!.kind).toBe('program');
    const statuses = await org.query<{ name: string }>(`select name from pm.statuses where project_id = $1 order by position collate "C"`, [programId]);
    expect(statuses.map((s) => s.name)).toEqual(['Planned', 'Staged', 'Building', 'Quality check', 'Done', 'Cancelled']);
    const dates = await org.query<{ build_date: string; n: number }>(`select build_date::text, count(*)::int as n from pm.builds where program_id = $1 group by 1 order by 1`, [programId]);
    expect(dates).toEqual([
      { build_date: '2026-11-25', n: 8 },
      { build_date: '2026-11-27', n: 8 },
      { build_date: '2026-11-30', n: 8 },
      { build_date: '2026-12-01', n: 8 },
      { build_date: '2026-12-02', n: 8 },
    ]);
    const lines = await org.query<{ kind: string; variant: string | null; price: string | null }>(
      `select l.kind, v.key as variant, l.unit_price::text as price from pm.price_card_lines l join pm.price_card_versions pv on pv.id = l.version_id left join pm.program_variants v on v.id = l.variant_id where pv.program_id = $1 and l.kind = 'per_unit' order by v.key nulls first`,
      [programId],
    );
    expect(lines.find((l) => l.variant === null)?.price).toBe('1.9500');
    expect(lines.filter((l) => l.variant?.startsWith('XL')).map((l) => l.price)).toEqual(['2.2000', '2.2000']);
    const ledger = await org.query<{ kind: string; cents: string }>(`select kind, cents::text from pm.program_ledger where program_id = $1 and deleted_at is null order by kind`, [programId]);
    expect(ledger.map((l) => l.kind).sort()).toEqual(['flat_monthly', 'setup']);
    expect(ledger.find((l) => l.kind === 'setup')?.cents).toBe('25000');
  });

  it('keeps programs and builds out of project surfaces', async () => {
    const list = await projectsDomain.listProjects(owner);
    expect(list.map((p) => p.key)).toEqual(['FRA']);
    const mine = await tasksDomain.listMyTasks(owner, { scope: 'all' });
    expect(mine.some((t) => t.kind === 'build')).toBe(false);
    const found = await searchDomain.search(owner, 'glove');
    expect(found.projects.some((p) => p.key === 'GLOVE')).toBe(false);
    const listed = await programs.listPrograms(owner);
    expect(listed.map((p) => p.key)).toEqual(['GLOVE']);
  });

  it('refuses generic project mutations on a program with the exact message', async () => {
    await expect(projectsDomain.updateProject(owner, programId, { startDate: '2026-12-01' })).rejects.toThrow('Use the program settings.');
    await expect(projectsDomain.archiveProject(owner, programId)).rejects.toThrow('Use the program settings.');
    await expect(projectsDomain.deleteProject(owner, programId)).rejects.toThrow('Use the program settings.');
    await expect(projectsDomain.duplicateProject(owner, programId, { name: 'Copy' })).rejects.toThrow('Use the program settings.');
    // Name changes still pass through.
    const renamed = await projectsDomain.updateProject(owner, programId, { name: 'Glove kits' });
    expect(renamed.name).toBe('Glove kits');
  });

  it('hides money from an org member without a program membership', async () => {
    const detail = await programs.getProgramDetail(member, 'GLOVE');
    expect(detail.moneyHidden).toBe(true);
    expect(detail.month.revenueCents).toBeNull();
    const summary = await programs.getProgramSummary(member, 'GLOVE');
    expect(summary.moneyHidden).toBe(true);
    expect(summary.result.totalCents).toBeNull();
    const ownerSummary = await programs.getProgramSummary(owner, 'GLOVE');
    expect(ownerSummary.moneyHidden).toBe(false);
    expect(ownerSummary.result.totalCents).not.toBeNull();
  });

  it('makes builds in a project too, which are not billed without a job', async () => {
    const build = await programs.createBuild(owner, 'FRA', { buildDate: '2026-11-25', plannedQty: '10', title: 'Frame batch' });
    expect(build.build.containerKind).toBe('project');
    expect(build.build.posting).toBe('unbilled');
    const tasks = await tasksDomain.listProjectTasks(owner, projectId);
    expect(tasks.find((t) => t.id === build.id)?.kind).toBe('build');
    expect(projectId).toBeTruthy();
  });
});
