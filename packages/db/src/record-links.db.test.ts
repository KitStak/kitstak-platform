/**
 * core.record_links and its helper against the live database (SPEC 2.1, 2.3, 9.2): direction
 * normalization, cache upserts, the money and kit indexes as TAKEN with UI copy, shape checks,
 * reads in both directions, and the pulse_app policy (rows of its own org only).
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgErrorOf } from './programs/executor';
import { createTestOrg, databaseReady, pgCode, type TestOrg } from './programs/test-support';
import {
  RecordLinkError,
  linkRecords,
  listRecordLinks,
  listRecordLinksMany,
  normalizeEdge,
  recordLinksAvailable,
  refreshLinkCache,
  storedLinkPath,
  unlinkRecords,
  type RecordRef,
} from './record-links';

const pgCodeDeep = (error: unknown) => pgErrorOf(error)?.code;

const ready = await databaseReady(['core.organization', 'core.record_links']);

describe('record link rules (pure)', () => {
  it('stores money and kit edges from the pm record outward', () => {
    const program: RecordRef = { type: 'pm_program', id: 'p1' };
    const job: RecordRef = { type: 'pulse_job', id: 'j1' };
    expect(normalizeEdge(job, program, 'bills_to')).toEqual({ from: program, to: job });
    const variant: RecordRef = { type: 'pm_variant', id: 'v1' };
    const item: RecordRef = { type: 'core_item', id: 'i1' };
    expect(normalizeEdge(item, variant, 'uses_kit')).toEqual({ from: variant, to: item });
  });

  it('puts the pm side first for related and belongs_to, else the lower pair', () => {
    const program: RecordRef = { type: 'pm_program', id: 'p1' };
    const deal: RecordRef = { type: 'crm_deal', id: 'd1' };
    expect(normalizeEdge(deal, program, 'related')).toEqual({ from: program, to: deal });
    expect(normalizeEdge(deal, program, 'belongs_to')).toEqual({ from: program, to: deal });
    const job: RecordRef = { type: 'pulse_job', id: 'j1' };
    expect(normalizeEdge(job, deal, 'related')).toEqual({ from: deal, to: job });
    const a: RecordRef = { type: 'pm_build', id: 'b2' };
    const b: RecordRef = { type: 'pm_build', id: 'b1' };
    expect(normalizeEdge(a, b, 'related')).toEqual({ from: b, to: a });
    expect(normalizeEdge(a, b, 'created_from')).toEqual({ from: a, to: b });
  });

  it('stores paths only', () => {
    expect(storedLinkPath('https://crm.example.com/items/1?tab=a#x')).toBe('/items/1?tab=a#x');
    expect(storedLinkPath('/programs/GLOVE')).toBe('/programs/GLOVE');
    expect(storedLinkPath('//evil.example.com/x')).toBeNull();
    expect(storedLinkPath('javascript:alert(1)')).toBeNull();
    expect(storedLinkPath('')).toBeNull();
  });
});

describe.skipIf(!ready)('core.record_links (database)', () => {
  let org: TestOrg;
  let other: TestOrg;
  const program = (): RecordRef => ({ type: 'pm_program', id: randomUUID() });
  const job = (): RecordRef => ({ type: 'pulse_job', id: randomUUID() });

  beforeAll(async () => {
    org = await createTestOrg('links');
    other = await createTestOrg('links-other');
  });
  afterAll(async () => {
    await org?.destroy();
    await other?.destroy();
  });

  it('is available', async () => {
    expect(await recordLinksAvailable(org.db)).toBe(true);
  });

  it('links in the stored direction and refreshes the cache on a repeat', async () => {
    const p = program();
    const deal: RecordRef = { type: 'crm_deal', id: randomUUID() };
    const first = await linkRecords(org.db, { orgId: org.orgId, from: deal, to: p, cache: { title: 'Winter liner add on', url: 'https://crm.example.com/items/9' }, createdBy: org.userId });
    expect(first.from).toEqual(p);
    expect(first.to).toEqual(deal);
    expect(first.relation).toBe('related');
    expect(first.cachedUrl).toBe('/items/9');
    expect(first.createdBy).toBe(org.userId);
    const again = await linkRecords(org.db, { orgId: org.orgId, from: p, to: deal, cache: { status: 'Won' }, meta: { note: 'x' } });
    expect(again.id).toBe(first.id);
    expect(again.cachedTitle).toBe('Winter liner add on');
    expect(again.cachedStatus).toBe('Won');
    expect(again.meta).toEqual({ note: 'x' });
  });

  it('refuses a second job for a program, a second program for a job and a second job for a build', async () => {
    const p1 = program();
    const p2 = program();
    const j1 = job();
    const j2 = job();
    await linkRecords(org.db, { orgId: org.orgId, from: p1, to: j1, relation: 'bills_to' });
    await expect(linkRecords(org.db, { orgId: org.orgId, from: p1, to: j2, relation: 'bills_to' })).rejects.toMatchObject({
      code: 'TAKEN',
      message: 'This program already bills to a Pulse job. Remove that link first.',
    });
    await expect(linkRecords(org.db, { orgId: org.orgId, from: p2, to: j1, relation: 'bills_to' })).rejects.toMatchObject({
      code: 'TAKEN',
      message: 'This Pulse job already takes revenue from another program.',
    });
    const build: RecordRef = { type: 'pm_build', id: randomUUID() };
    await linkRecords(org.db, { orgId: org.orgId, from: build, to: j1, relation: 'bills_to' });
    await expect(linkRecords(org.db, { orgId: org.orgId, from: build, to: j2, relation: 'bills_to' })).rejects.toMatchObject({
      code: 'TAKEN',
      message: 'This build already bills to a Pulse job.',
    });
    // The same edge again is not a refusal.
    await expect(linkRecords(org.db, { orgId: org.orgId, from: j1, to: p1, relation: 'bills_to' })).resolves.toMatchObject({ from: p1, to: j1 });
    // Another org may use the same ids.
    await expect(linkRecords(other.db, { orgId: other.orgId, from: p2, to: j1, relation: 'bills_to' })).resolves.toMatchObject({ relation: 'bills_to' });
  });

  it('allows one kit of each kind per variant', async () => {
    const variant: RecordRef = { type: 'pm_variant', id: randomUUID() };
    await linkRecords(org.db, { orgId: org.orgId, from: variant, to: { type: 'core_item', id: randomUUID() }, relation: 'uses_kit' });
    await linkRecords(org.db, { orgId: org.orgId, from: variant, to: { type: 'wms_product', id: 'APX-KIT-TEE3' }, relation: 'uses_kit' });
    await expect(linkRecords(org.db, { orgId: org.orgId, from: variant, to: { type: 'core_item', id: randomUUID() }, relation: 'uses_kit' })).rejects.toMatchObject({ code: 'TAKEN' });
  });

  it('refuses invalid edges before and inside the database', async () => {
    const p = program();
    await expect(linkRecords(org.db, { orgId: org.orgId, from: p, to: p })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(linkRecords(org.db, { orgId: org.orgId, from: p, to: { type: 'crm_deal', id: 'd' }, relation: 'bills_to' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(linkRecords(org.db, { orgId: org.orgId, from: p, to: { type: 'core_item', id: 'i' }, relation: 'uses_kit' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(linkRecords(org.db, { orgId: org.orgId, from: { type: 'nope' as never, id: 'x' }, to: p })).rejects.toBeInstanceOf(RecordLinkError);
    // The SQL shape checks hold even without the helper.
    await expect(
      org.query(`insert into core.record_links (org_id, from_type, from_id, to_type, to_id, relation) values ($1, 'crm_deal', 'd', 'pulse_job', 'j', 'bills_to')`, [org.orgId]),
    ).rejects.toSatisfy((error) => pgCode(error) === '23514');
    await expect(
      org.query(`insert into core.record_links (org_id, from_type, from_id, to_type, to_id, cached_url) values ($1, 'pm_program', 'p', 'crm_deal', 'd', '//evil')`, [org.orgId]),
    ).rejects.toSatisfy((error) => pgCode(error) === '23514');
  });

  it('keeps the caller transaction usable after a TAKEN refusal (savepoint)', async () => {
    const db = org.db;
    const p1 = program();
    const p2 = program();
    const j1 = job();
    const result = await db.transaction(async (tx) => {
      await linkRecords(tx, { orgId: org.orgId, from: p1, to: j1, relation: 'bills_to' });
      await expect(linkRecords(tx, { orgId: org.orgId, from: p2, to: j1, relation: 'bills_to' })).rejects.toMatchObject({ code: 'TAKEN' });
      return linkRecords(tx, { orgId: org.orgId, from: p2, to: { type: 'crm_account', id: 'acc-1' }, relation: 'belongs_to' });
    });
    expect(result.relation).toBe('belongs_to');
    expect(await listRecordLinks(db, org.orgId, p1)).toHaveLength(1);
  });

  it('lists both directions newest first, with relation and other type filters', async () => {
    const p = program();
    const j = job();
    const deal: RecordRef = { type: 'crm_deal', id: randomUUID() };
    const account: RecordRef = { type: 'crm_account', id: randomUUID() };
    await linkRecords(org.db, { orgId: org.orgId, from: p, to: deal, relation: 'created_from' });
    await linkRecords(org.db, { orgId: org.orgId, from: p, to: account, relation: 'belongs_to' });
    await linkRecords(org.db, { orgId: org.orgId, from: p, to: j, relation: 'bills_to' });
    const all = await listRecordLinks(org.db, org.orgId, p);
    expect(all.map((row) => row.relation)).toEqual(['bills_to', 'belongs_to', 'created_from']);
    expect((await listRecordLinks(org.db, org.orgId, j)).map((row) => row.from)).toEqual([p]);
    expect(await listRecordLinks(org.db, org.orgId, p, { relation: 'bills_to' })).toHaveLength(1);
    expect((await listRecordLinks(org.db, org.orgId, p, { otherType: 'crm_account' })).map((row) => row.to)).toEqual([account]);
    expect(await listRecordLinks(other.db, other.orgId, p)).toEqual([]);
    const many = await listRecordLinksMany(org.db, org.orgId, [deal, account, j]);
    expect(many).toHaveLength(3);
    expect(await listRecordLinksMany(org.db, org.orgId, [deal, account], { relation: 'belongs_to' })).toHaveLength(1);
    expect(await listRecordLinksMany(org.db, org.orgId, [])).toEqual([]);
  });

  it('refreshes the cache on every edge touching a record and unlinks by id', async () => {
    const deal: RecordRef = { type: 'crm_deal', id: randomUUID() };
    const a = await linkRecords(org.db, { orgId: org.orgId, from: program(), to: deal });
    await linkRecords(org.db, { orgId: org.orgId, from: { type: 'pm_project', id: randomUUID() }, to: deal });
    expect(await refreshLinkCache(org.db, org.orgId, deal, { title: 'Renamed deal', status: 'Negotiation' })).toBe(2);
    expect(await refreshLinkCache(org.db, org.orgId, deal, {})).toBe(0);
    const rows = await listRecordLinks(org.db, org.orgId, deal);
    expect(rows.every((row) => row.cachedTitle === 'Renamed deal' && row.cachedStatus === 'Negotiation' && row.cachedAt !== null)).toBe(true);
    expect(await unlinkRecords(other.db, other.orgId, a.id)).toBe(false);
    expect(await unlinkRecords(org.db, org.orgId, a.id)).toBe(true);
    expect(await unlinkRecords(org.db, org.orgId, a.id)).toBe(false);
    expect(await listRecordLinks(org.db, org.orgId, deal)).toHaveLength(1);
  });

  it('lets pulse_app read and write only the rows of the org in pulse.org_id', async () => {
    const [role] = await org.query<{ ok: boolean }>(`select exists (select 1 from pg_roles where rolname = 'pulse_app') as ok`);
    if (!role?.ok) return;
    const mine = await linkRecords(org.db, { orgId: org.orgId, from: program(), to: job(), relation: 'related' });
    const theirs = await linkRecords(other.db, { orgId: other.orgId, from: program(), to: job(), relation: 'related' });
    const rowsOf = (result: unknown) => (result as { rows: Record<string, unknown>[]; rowCount: number | null });
    const done = new Error('rollback');
    await expect(
      org.db.transaction(async (tx) => {
        await tx.execute(sql`set local role pulse_app`);
        await tx.execute(sql`select set_config('pulse.org_id', ${org.orgId}, true)`);
        const seen = rowsOf(await tx.execute(sql`select id::text as id from core.record_links where id in (${mine.id}::uuid, ${theirs.id}::uuid)`));
        expect(seen.rows.map((row) => row.id)).toEqual([mine.id]);
        const written = await linkRecords(tx, { orgId: org.orgId, from: program(), to: job(), relation: 'bills_to' });
        expect(written.orgId).toBe(org.orgId);
        expect(rowsOf(await tx.execute(sql`update core.record_links set cached_title = 'x' where id = ${theirs.id}::uuid`)).rowCount).toBe(0);
        expect(rowsOf(await tx.execute(sql`delete from core.record_links where id = ${theirs.id}::uuid`)).rowCount).toBe(0);
        await expect(
          tx.transaction(async (inner) =>
            inner.execute(sql`insert into core.record_links (org_id, from_type, from_id, to_type, to_id) values (${other.orgId}::uuid, 'pm_program', ${randomUUID()}, 'crm_deal', 'd')`),
          ),
        ).rejects.toSatisfy((error) => pgCodeDeep(error) === '42501');
        throw done;
      }),
    ).rejects.toBe(done);
    const still = await other.db.execute(sql`select count(*)::int as n from core.record_links where id = ${theirs.id}::uuid`);
    expect((still as unknown as { rows: { n: number }[] }).rows[0]?.n).toBe(1);
  });
});
