/**
 * Change notes from sibling apps (`pulse.bridge_events`): a claim is a five minute lease, a note
 * is done only once it was handled, a failure is tried again later, and five failed tries park it.
 * Skipped when no database answers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from './_shared';
import { BRIDGE_EVENT_MAX_ATTEMPTS, claimBridgeEvents, finishBridgeEvents, syncIfStale } from './test-exports';

const ready = await databaseReady();
const TARGET = '00000000-0000-4000-8000-0000000000e1';

interface EventRow {
  id: string;
  attempts: number;
  claimed: boolean;
  processed: boolean;
  last_error: string | null;
}

describe.skipIf(!ready)('bridge events: lease, retry and park', () => {
  let org: TestOrg;
  let owner: DomainContext;

  beforeAll(async () => {
    org = await createTestOrg('pulse-bridge-ev');
    owner = await org.member('owner', 'Events Owner');
  }, 60_000);
  afterAll(async () => {
    await org?.destroy();
  });
  beforeEach(async () => {
    await org.query('delete from pulse.bridge_events where org_id = $1', [org.orgId]);
    await org.query('update pulse.sync_state set locked_until = null where org_id = $1', [org.orgId]);
  });

  const addEvent = async (kind = 'crm_deal_stage_changed'): Promise<string> =>
    (await org.query<{ id: string }>(`insert into pulse.bridge_events (org_id, kind, target_id, payload) values ($1, $2, $3, '{}'::jsonb) returning id::text as id`, [org.orgId, kind, TARGET]))[0]!.id;
  const events = () =>
    org.query<EventRow>('select id::text as id, attempts, claimed_at is not null as claimed, processed_at is not null as processed, last_error from pulse.bridge_events where org_id = $1 order by created_at', [org.orgId]);
  const ageClaims = () => org.query("update pulse.bridge_events set claimed_at = now() - interval '6 minutes' where org_id = $1 and claimed_at is not null", [org.orgId]);

  it('a claim is a lease, not done: processed_at waits for the note to be handled', async () => {
    const id = await addEvent();
    const claimed = await claimBridgeEvents(owner);
    expect(claimed.bySource.get('crm')).toEqual([id]);
    expect(await events()).toEqual([{ id, attempts: 1, claimed: true, processed: false, last_error: null }]);
    // Another request does not take a note someone holds.
    expect((await claimBridgeEvents(owner)).bySource.size).toBe(0);
    await finishBridgeEvents(owner, [id], { outcome: 'done' });
    expect((await events())[0]).toMatchObject({ processed: true, last_error: null });
  });

  it('a failed note is tried again after the lease runs out, and parks after five tries', async () => {
    const id = await addEvent();
    for (let attempt = 1; attempt <= BRIDGE_EVENT_MAX_ATTEMPTS; attempt += 1) {
      const claimed = await claimBridgeEvents(owner);
      expect(claimed.bySource.get('crm')).toEqual([id]);
      await finishBridgeEvents(owner, [id], { outcome: 'failed', error: `CRM did not answer (${attempt})` });
      const [row] = await events();
      expect(row).toMatchObject({ attempts: attempt, last_error: `CRM did not answer (${attempt})`, processed: attempt === BRIDGE_EVENT_MAX_ATTEMPTS });
      if (attempt < BRIDGE_EVENT_MAX_ATTEMPTS) {
        // Still inside the lease: not taken again yet.
        expect((await claimBridgeEvents(owner)).bySource.size).toBe(0);
        await ageClaims();
      }
    }
    // Parked notes are never taken again, and a new change for the same record can be noted.
    await ageClaims();
    expect((await claimBridgeEvents(owner)).bySource.size).toBe(0);
    await expect(addEvent()).resolves.toBeTruthy();
  });

  it('a note dropped mid run is retaken after five minutes, and parked once it used its tries', async () => {
    const id = await addEvent();
    await org.query(`update pulse.bridge_events set attempts = $2, claimed_at = now() - interval '6 minutes' where id = $1`, [id, BRIDGE_EVENT_MAX_ATTEMPTS]);
    expect((await claimBridgeEvents(owner)).bySource.size).toBe(0);
    const [row] = await events();
    expect(row).toMatchObject({ processed: true });
    expect(row?.last_error).toMatch(/Gave up after 5 tries/);
  });

  it('when another sync holds the app, the note is given back and taken on the next load', async () => {
    const id = await addEvent();
    await org.query(
      `insert into pulse.sync_state (org_id, source, locked_until) values ($1, 'crm', now() + interval '5 minutes')
       on conflict (org_id, source) do update set locked_until = excluded.locked_until`,
      [org.orgId],
    );
    await syncIfStale({ ...owner, actorKind: 'system' });
    expect(await events()).toEqual([{ id, attempts: 0, claimed: false, processed: false, last_error: null }]);
    await org.query('update pulse.sync_state set locked_until = null where org_id = $1', [org.orgId]);
    await syncIfStale({ ...owner, actorKind: 'system' });
    expect((await events())[0]).toMatchObject({ attempts: 1, processed: true, last_error: null });
  }, 60_000);

  it('a note for an app this workspace does not have is done, not left waiting', async () => {
    await addEvent('wms_work_order_changed');
    await syncIfStale({ ...owner, actorKind: 'system' });
    expect((await events())[0]).toMatchObject({ processed: true });
  }, 60_000);
});
