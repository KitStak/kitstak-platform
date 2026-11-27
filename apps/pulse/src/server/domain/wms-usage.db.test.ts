/**
 * Parts used, from the warehouse, against the local database. The throwaway org gets its own tiny
 * warehouse schema (`wms_<org hex>`, only the tables and columns the reader needs) so the test
 * never reads or writes a real warehouse. Skipped when no database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from './_shared';
import { addJobLink, createClient, createJob, pullWmsUsage, saveMaterialUsage } from './test-exports';

const ready = await databaseReady();

const WO = '11111111-1111-4111-8111-000000000001';
const KIT = 'kit-product-1';
const PART_A = 'part-a';
const PART_B = 'part-b';
const WC_A = '22222222-2222-4222-8222-00000000000a';
const WC_B = '22222222-2222-4222-8222-00000000000b';

describe.skipIf(!ready)('parts used, dated the day the warehouse used them', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let jobId: string;
  let jobNumber: string;
  let schema: string;
  let oldRowId: string;

  beforeAll(async () => {
    org = await createTestOrg('pulse-wmsuse');
    owner = await org.member('owner', 'Usage Owner');
    schema = `wms_${org.orgId.replace(/-/g, '')}`;
    await org.query(`create schema "${schema}"`);
    await org.query(`create table "${schema}".shipment_orders (id text primary key)`);
    await org.query(`create table "${schema}".products (id text primary key, sku text, name text, purchase_price double precision)`);
    await org.query(`create table "${schema}".work_orders (id text primary key, code text, kit_product_id text, actual_start_at text, actual_finish_at text)`);
    await org.query(`create table "${schema}".work_order_components (id text primary key, work_order_id text, component_product_id text, consumed_qty integer)`);
    await org.query(`create table "${schema}".inventory_transactions (id text primary key, type text, product_id text, work_order_id text, from_location_id text, to_location_id text, uom_qty integer, at text)`);
    await org.query(`insert into "${schema}".products values ($1, 'KIT-1', 'Kit', 0), ($2, 'TEST-A', 'Part A', 1.25), ($3, 'TEST-B', 'Part B', 0.333)`, [KIT, PART_A, PART_B]);
    await org.query(`insert into "${schema}".work_orders values ($1, 'WO000777', $2, '2026-10-13T14:00:00Z', '2026-10-15T20:00:00Z')`, [WO, KIT]);
    await org.query(`insert into "${schema}".work_order_components values ($1, $2, $3, 12), ($4, $2, $5, 5)`, [WC_A, WO, PART_A, WC_B, PART_B]);
    // 03:00 UTC on the 14th is still the 13th in Chicago. Part B has no ledger rows: it goes on the build day.
    await org.query(
      `insert into "${schema}".inventory_transactions values
         ('t1', 'Kitting', $1, $3, 'loc', null, 8, '2026-10-14T03:00:00.000Z'),
         ('t2', 'Kitting', $1, $3, 'loc', null, 4, '2026-10-15T15:00:00.000Z'),
         ('t3', 'Kitting', $2, $3, null, 'loc', 12, '2026-10-15T15:00:01.000Z'),
         ('t4', 'Allocation', $1, $3, 'loc', null, 99, '2026-10-12T15:00:00.000Z')`,
      [PART_A, KIT, WO],
    );
    await org.query(`insert into core.wms_tenants (org_id, schema_name, status, created_at) values ($1, $2, 'active', now())`, [org.orgId, schema]);
    // The warehouse is set up before anything in Pulse asks for it (Pulse keeps the answer for a minute).
    const client = await createClient(owner, { name: 'Usage Client' });
    const job = await createJob(owner, { name: 'Kit build', clientId: client.id, status: 'active', plannedUnits: '12', unitPrice: '5.0000' });
    jobId = job.id;
    jobNumber = job.number;
    await org.query(`update pulse.sites set timezone = 'America/Chicago' where org_id = $1`, [org.orgId]);
    await addJobLink(owner, jobId, { targetType: 'wms_work_order', targetId: WO, title: 'WO000777' });
    // What an older pull left behind: all 12 parts dated on the sync day, with the count in the ref.
    const old = await saveMaterialUsage({ ...owner, actorKind: 'system' }, { jobId, usageDate: '2026-11-18', itemSku: 'TEST-A', itemName: 'Part A', quantityUsed: '12', unitCost: '1.2500', source: 'wms', sourceRef: `woc:${WC_A}:2026-11-18:12` });
    oldRowId = old.id;
  }, 60_000);

  afterAll(async () => {
    if (!org) return;
    await org.query('delete from core.wms_tenants where org_id = $1', [org.orgId]).catch(() => undefined);
    await org.query(`drop schema if exists "${schema}" cascade`).catch(() => undefined);
    await org.destroy();
  });

  const usage = () =>
    org.query<{ id: string; sku: string; day: string; qty: string; ref: string; cost_cents: string }>(
      `select id, item_sku as sku, usage_date::text as day, quantity_used::text as qty, source_ref as ref, cost_cents::text as cost_cents
         from pulse.material_usage where org_id = $1 and deleted_at is null order by item_sku, usage_date`,
      [org.orgId],
    );

  it('dates each part on the day it left the shelf, in the site time zone, and moves the old row', async () => {
    const result = await pullWmsUsage(owner, jobNumber);
    const rows = await usage();
    expect(rows.map(({ sku, day, qty, ref }) => ({ sku, day, qty, ref }))).toEqual([
      { sku: 'TEST-A', day: '2026-10-13', qty: '8.000', ref: `woc:${WC_A}:2026-10-13` },
      { sku: 'TEST-A', day: '2026-10-15', qty: '4.000', ref: `woc:${WC_A}:2026-10-15` },
      { sku: 'TEST-B', day: '2026-10-15', qty: '5.000', ref: `woc:${WC_B}:2026-10-15` },
    ]);
    // The old row was moved, not copied: no part is counted twice and nothing is dated on the sync day.
    expect(rows.some((row) => row.id === oldRowId)).toBe(true);
    expect(result.updated).toBe(1);
    expect(result.added).toHaveLength(2);
    // 5 x $0.333 = $1.665, rounded once in whole cents.
    expect(rows.find((row) => row.sku === 'TEST-B')?.cost_cents).toBe('167');
    expect(rows.find((row) => row.day === '2026-10-13')?.cost_cents).toBe('1000');
  }, 60_000);

  it('a second pull changes nothing', async () => {
    const before = await usage();
    const again = await pullWmsUsage(owner, jobNumber);
    expect({ added: again.added.length, updated: again.updated, removed: again.removed }).toEqual({ added: 0, updated: 0, removed: 0 });
    expect(await usage()).toEqual(before);
    expect(again.preview.rowsToAdd).toBe(0);
    expect(again.preview.addCents).toBe(0);
  }, 60_000);

  it('follows the warehouse when it takes parts back', async () => {
    await org.query(`update "${schema}".work_order_components set consumed_qty = 10 where id = $1`, [WC_A]);
    await org.query(`insert into "${schema}".inventory_transactions values ('t5', 'Kitting', $1, $2, null, 'loc', 2, '2026-10-15T16:00:00.000Z')`, [PART_A, WO]);
    const result = await pullWmsUsage(owner, jobNumber);
    const rows = (await usage()).filter((row) => row.sku === 'TEST-A');
    expect(rows.map(({ day, qty }) => ({ day, qty }))).toEqual([
      { day: '2026-10-13', qty: '8.000' },
      { day: '2026-10-15', qty: '2.000' },
    ]);
    expect(result.updated).toBe(1);
  }, 60_000);
});
