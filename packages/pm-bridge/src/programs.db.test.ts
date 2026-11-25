/**
 * Program reads of the bridge against the shared local Postgres (docs/programs/SPEC.md 6.2, 6.3,
 * 10.2 L6): kind filters keep programs out of project lists and writes, `listLinkedPrograms`
 * shows the money the shared reader (and so Projects) shows, money is hidden by the Projects
 * rule, and `listProgramsForKit` finds the programs that build a kit. Each run makes its own
 * throwaway organization (SPEC B.3) and removes it at the end.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readProgramMonth } from '@kitstak/db/programs';
import { createTestOrg, databaseReady, seedGloveFixture, type GloveFixture, type TestOrg } from '../../db/src/programs/test-support';
import {
  countLinkedPrograms,
  countLinkedWork,
  createTaskFromExternal,
  linkProjectToRecord,
  listLinkedPrograms,
  listLinkedWork,
  listProgramsForKit,
  listWritableProjects,
  PROGRAM_REFUSAL,
  resetAvailabilityCache,
  type BridgeExecutor,
} from './index';

const ready = await databaseReady(['pm.build_output', 'core.record_links', 'pm.integration_links']);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const NOW = new Date('2026-11-25T18:00:00Z');
const URLS = { projectsUrl: 'https://projects.example/' };

describe.skipIf(!ready)('pm-bridge programs (database)', () => {
  let org: TestOrg;
  let glove: GloveFixture;
  let db: BridgeExecutor;
  const accountId = randomUUID();
  const dealId = randomUUID();
  const legacyAccountId = randomUUID();

  beforeAll(async () => {
    org = await createTestOrg('pm-bridge-programs');
    glove = await seedGloveFixture(org, { output: true, key: 'GLVB' });
    db = org.db as unknown as BridgeExecutor;
    resetAvailabilityCache(db);
    await org.query(
      `insert into core.record_links (org_id, from_type, from_id, to_type, to_id, relation, cached_title)
       values ($1, 'pm_program', $2, 'crm_account', $3, 'belongs_to', 'Gripwell Safety Supply'),
              ($1, 'pm_program', $2, 'crm_deal', $4, 'created_from', 'Glove kitting program')`,
      [org.orgId, glove.programId, accountId, dealId],
    );
    // A legacy project level link to a program, and one to the plain project.
    await org.query(
      `insert into pm.integration_links (org_id, project_id, target_type, target_id, cached_title)
       values ($1, $2, 'crm_account', $4, 'Old account'), ($1, $3, 'crm_account', $4, 'Old account')`,
      [org.orgId, glove.programId, glove.projectId, legacyAccountId],
    );
    // One open build on Nov 27 for the next build date.
    const taskId = randomUUID();
    await org.tx(async (client) => {
      await client.query(
        `insert into pm.tasks (id, org_id, project_id, number, title, status_id, position, kind, start_date, due_date)
         values ($1, $2, $3, 9001, 'S-BRN 2026-11-27', $4, 'zz', 'build', '2026-11-27', '2026-11-27')`,
        [taskId, org.orgId, glove.programId, glove.statusTodo],
      );
      await client.query(
        `insert into pm.builds (task_id, org_id, container_id, program_id, variant_id, build_date, planned_qty, planned_from)
         values ($1, $2, $3, $3, $4, '2026-11-27', 100, 'manual')`,
        [taskId, org.orgId, glove.programId, glove.variants['S-BRN']],
      );
    });
    await org.query(`update pm.program_variants set wms_product_id = 'P-KIT-SBRN' where id = $1`, [glove.variants['S-BRN']]);
  });

  afterAll(async () => {
    if (org) await org.destroy();
  });

  const owner = () => ({ orgId: org.orgId, userId: org.userId });

  it('lists the program for its account and deal with the money Projects reads', async () => {
    const result = await listLinkedPrograms(db, owner(), [{ type: 'crm_account', id: accountId }], URLS, { now: NOW });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.programs).toHaveLength(1);
    const program = result.programs[0]!;
    expect(program.key).toBe('GLVB');
    expect(program.linkVia).toBe('record_link');
    expect(program.customerName).toBe('Gripwell Safety Supply');
    expect(program.url).toBe('https://projects.example/programs/GLVB');
    const read = await readProgramMonth(org.db, org.orgId, glove.programId, '2026-11');
    const expected = read.output.reduce((sum, row) => sum + BigInt(row.revenueCents), BigInt(0)) + read.ledger.reduce((sum, row) => sum + row.cents, BigInt(0));
    expect(program.month.revenueCents).toBe(expected.toString());
    // 17 work days in November through the 24th, 8 builds of 100.
    expect(program.month.units).toBe('13600.000');
    expect(program.moneyHidden).toBe(false);
    expect(program.cardSummary).toContain('$1.95 per kit');
    expect(program.today).toEqual({ date: '2026-11-25', builds: 0, done: 0 });
    // The target the forecast percent is measured against, straight from the program row.
    const [target] = await org.query<{ cents: string | null }>(`select monthly_target_cents::text as cents from pm.program_settings where program_id = $1`, [glove.programId]);
    expect(program.month.targetCents).toBe(target?.cents ?? null);
    expect(program.month.targetBp === null).toBe(program.month.targetCents === null);
    expect(result.moneyHidden).toBe(false);
  });

  it('matches through a legacy project link and counts the same', async () => {
    const result = await listLinkedPrograms(db, owner(), [{ type: 'crm_account', id: legacyAccountId }], URLS, { now: NOW });
    expect(result.available && result.programs.map((p) => [p.key, p.linkVia])).toEqual([['GLVB', 'integration_link']]);
    expect(await countLinkedPrograms(db, owner(), [{ type: 'crm_account', id: legacyAccountId }])).toBe(1);
    expect(await countLinkedPrograms(db, owner(), [{ type: 'crm_account', id: randomUUID() }])).toBe(0);
  });

  it('hides money for an implicit org member and shows it for an explicit editor', async () => {
    const member = await org.addUser('member');
    const hidden = await listLinkedPrograms(db, { orgId: org.orgId, userId: member }, [{ type: 'crm_account', id: accountId }], URLS, { now: NOW });
    expect(hidden.available && hidden.programs[0]).toMatchObject({ moneyHidden: true, cardSummary: null, deal: null, month: { revenueCents: null, forecastCents: null, targetCents: null, units: '13600.000' } });
    expect(hidden.available && hidden.moneyHidden).toBe(true);
    await org.query(`insert into pm.project_members (project_id, user_id, role, org_id) values ($1, $2, 'editor', $3)`, [glove.programId, member, org.orgId]);
    const shown = await listLinkedPrograms(db, { orgId: org.orgId, userId: member }, [{ type: 'crm_account', id: accountId }], URLS, { now: NOW });
    expect(shown.available && shown.programs[0]?.moneyHidden).toBe(false);
  });

  it('keeps programs out of project lists, counts and writes', async () => {
    const work = await listLinkedWork(db, owner(), [{ type: 'crm_account', id: legacyAccountId }], URLS);
    expect(work.projects.map((p) => p.id)).toEqual([glove.projectId]);
    const counts = await countLinkedWork(db, owner(), 'crm_account', [legacyAccountId]);
    expect(counts[legacyAccountId]?.projects).toBe(1);
    const writable = await listWritableProjects(db, owner());
    expect(writable.map((p) => p.id)).not.toContain(glove.programId);
    expect(writable.map((p) => p.id)).toContain(glove.projectId);
    const link = { type: 'crm_item' as const, id: dealId, title: 'Glove kitting program' };
    await expect(createTaskFromExternal(db, owner(), { projectId: glove.programId, title: 'Call the buyer', link, source: 'crm' }, URLS)).rejects.toThrow(PROGRAM_REFUSAL);
    await expect(linkProjectToRecord(db, owner(), glove.programId, link)).rejects.toThrow(PROGRAM_REFUSAL);
    const created = await createTaskFromExternal(db, owner(), { projectId: glove.projectId, title: 'Call the buyer', link, source: 'crm' }, URLS);
    const [row] = await org.query<{ kind: string }>(`select kind from pm.tasks where id = $1`, [created.task.id]);
    expect(row?.kind).toBe('task');
  });

  it('finds the programs that build a kit, with units for the week and the month', async () => {
    const result = await listProgramsForKit(db, owner(), { wmsProductId: 'P-KIT-SBRN' }, URLS, { now: NOW });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.programs).toHaveLength(1);
    expect(result.programs[0]).toMatchObject({
      key: 'GLVB',
      variant: { id: glove.variants['S-BRN'], name: 'Small Brown', sku: 'GLVB-S-BRN' },
      // Mon Nov 23 and Tue Nov 24 (100 each) plus the open build on Fri Nov 27.
      plannedThisWeek: '300.000',
      builtThisMonth: '1700.000',
      nextBuildDate: '2026-11-27',
      url: 'https://projects.example/programs/GLVB',
    });
    const none = await listProgramsForKit(db, owner(), { wmsProductId: 'NOT-A-KIT' }, URLS, { now: NOW });
    expect(none.available && none.programs).toEqual([]);
  });

  it('answers no access for someone outside the org', async () => {
    const result = await listLinkedPrograms(db, { orgId: org.orgId, userId: randomUUID() }, [{ type: 'crm_account', id: accountId }], URLS, { now: NOW });
    expect(result).toEqual({ available: false, reason: 'no_access' });
  });
});
