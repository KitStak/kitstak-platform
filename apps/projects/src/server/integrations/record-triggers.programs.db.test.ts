/**
 * The deal won recipe with `action: 'create_program'` (docs/programs/SPEC.md 6.2, 8.4): two
 * events for the same won deal at the same moment make exactly one program, a later retry is
 * skipped with the program's key, and existing project recipes still make projects only.
 * Runs in a throwaway org on the program clock fixed at 2026-11-25.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from '@/server/domain/_shared';

const ready = await databaseReady(['pm.projects', 'pm.builds', 'pm.program_settings', 'core.record_links', 'pm.record_trigger_runs']);

describe.skipIf(!ready)('record triggers: start a program from a won deal', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let triggers: typeof import('./record-triggers');
  let programs: typeof import('@/server/domain/programs');

  beforeAll(async () => {
    triggers = await import('./record-triggers');
    programs = await import('@/server/domain/programs');
    programs.setProgramClock(() => new Date('2026-11-25T15:00:00Z'));
    org = await createTestOrg('deal-won-program');
    owner = await org.member('owner', 'Maya Owner');
    await org.query(`insert into pm.org_calendar (org_id, timezone, working_days) values ($1, 'America/Chicago', '{1,2,3,4,5}')`, [org.orgId]);
  });

  afterAll(async () => {
    programs?.resetProgramClock();
    await org?.destroy();
  });

  const actor = (): DomainContext => ({ ...owner, userName: 'Automation', orgRole: 'owner', actorKind: 'automation', automationDepth: 1 });

  it('makes one program for two events at once, then skips a retry', async () => {
    const deal = { id: randomUUID(), title: 'Gripwell Safety Supply · Glove kitting program' };
    const config = { action: 'create_program' as const, ownerId: owner.userId };
    const results = await Promise.all([
      triggers.fireDealWonForTest(actor(), config, deal, randomUUID()),
      triggers.fireDealWonForTest(actor(), config, deal, randomUUID()),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const made = await org.query<{ key: string; kind: string; crm_item_id: string | null }>(
      `select key, kind, crm_item_id::text from pm.projects where org_id = $1 and deleted_at is null and kind = 'program'`,
      [org.orgId],
    );
    expect(made).toHaveLength(1);
    expect(made[0]!.crm_item_id).toBe(deal.id);
    const edges = await org.query<{ relation: string }>(
      `select relation from core.record_links where org_id = $1 and ((to_type = 'crm_deal' and to_id = $2) or (from_type = 'crm_deal' and from_id = $2))`,
      [org.orgId, deal.id],
    );
    expect(edges.map((edge) => edge.relation)).toContain('created_from');
    expect(await triggers.fireDealWonForTest(actor(), config, deal, randomUUID())).toBe(false);
    const after = await org.query(`select 1 from pm.projects where org_id = $1 and kind = 'program' and deleted_at is null`, [org.orgId]);
    expect(after).toHaveLength(1);
  });

  it('reads the action from the stored config, defaulting to a project', () => {
    expect(triggers.dealWonAction({})).toBe('create_project');
    expect(triggers.dealWonAction({ action: 'create_project' })).toBe('create_project');
    expect(triggers.dealWonAction({ action: 'create_program' })).toBe('create_program');
    expect(triggers.dealWonAction({ action: 'something else' })).toBe('create_project');
  });
});
