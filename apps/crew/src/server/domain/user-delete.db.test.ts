/**
 * Migration 0001_crew_user_delete: a person who did something in Crew can still be deleted. The
 * activity log stays append only (KC002) except for the one change ON DELETE SET NULL makes:
 * `actor_id` going from a person to null with every other column unchanged.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbGuardStatus } from '@/server/db/system';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from './_shared';
import { createPerson } from './people';
import { ensureSetup } from './settings';

const ready = (await databaseReady()) && (await dbGuardStatus()).ready;

describe.skipIf(!ready)('deleting a person who acted in Crew (0001_crew_user_delete)', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let actor: DomainContext;

  beforeAll(async () => {
    org = await createTestOrg('crew-user-delete');
    owner = await org.member('owner', 'Delete Owner');
    actor = await org.member('admin', 'Delete Actor');
    await ensureSetup(owner.orgId);
    await createPerson(actor, { number: '7001', firstName: 'Made', lastName: 'ByActor' });
  }, 60_000);

  afterAll(async () => {
    await org?.destroy();
  });

  it('refuses any other change to an activity row, and blanking plus another change in one statement', async () => {
    const [row] = await org.query<{ id: string }>('select id from crew.activity where org_id = $1 and actor_id = $2 limit 1', [org.orgId, actor.userId]);
    expect(row).toBeDefined();
    await expect(org.query("update crew.activity set verb = 'changed' where id = $1", [row!.id])).rejects.toMatchObject({ code: 'KC002' });
    await expect(org.query("update crew.activity set actor_id = null, verb = 'changed' where id = $1", [row!.id])).rejects.toMatchObject({ code: 'KC002' });
    await expect(org.query('update crew.activity set actor_id = $2 where id = $1', [row!.id, owner.userId])).rejects.toMatchObject({ code: 'KC002' });
    await expect(org.query("update crew.activity set after = '{}'::jsonb where id = $1", [row!.id])).rejects.toMatchObject({ code: 'KC002' });
  });

  it('lets the member be deleted: their activity stays with actor_id null', async () => {
    const before = await org.query<{ n: number }>('select count(*)::int as n from crew.activity where org_id = $1 and actor_id = $2', [org.orgId, actor.userId]);
    expect(before[0]!.n).toBeGreaterThan(0);
    await org.query('delete from core."user" where id = $1', [actor.userId]);
    const after = await org.query<{ blank: number; mine: number }>(
      "select count(*) filter (where actor_id is null and verb = 'person.created')::int as blank, count(*) filter (where actor_id = $2)::int as mine from crew.activity where org_id = $1",
      [org.orgId, actor.userId],
    );
    expect(after[0]).toEqual({ blank: 1, mine: 0 });
  });
});
