/**
 * Warehouse extra services and contract rates into Pulse money, against the local database.
 * The throwaway org gets its own tiny warehouse schema (`wms_<org hex>`, only the tables and
 * columns the readers need), so the test never reads or writes a real warehouse. A second
 * throwaway org has no warehouse at all. Skipped when no database answers.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import { listVasRecords } from '@/server/integrations/wms';
import type { DomainContext } from './_shared';
import { runSync } from './sync';
import { addJobLink, closePeriod, createClient, createJob, createVasService, deleteVasEntry, getConnectedApps, getJob, getJobProfit, getSettings, listJobPrices, listVasEntries, pullWmsServices, saveProductionEntry, saveVasEntry, setJobPrice, setJobStatus, updateSettings } from './test-exports';

const ready = await databaseReady();

const WAREHOUSE = 'wh-1';
const WO_KIT = '11111111-1111-4111-8111-0000000000a1';
const WO_FLAT = '11111111-1111-4111-8111-0000000000a2';
const WO_NEW = '11111111-1111-4111-8111-0000000000a3';
const WO_DONE = '11111111-1111-4111-8111-0000000000a4';
const TYPE_PROJECT = 'type-special-project';
const TYPE_PROGRAM = 'type-programming';
const TYPE_PALLET = 'type-pallet';
const VAS_OWN = 'vas-own-total';
const VAS_RATE = 'vas-contract-rate';
const VAS_FRACTION = 'vas-fraction';
const VAS_NONE = 'vas-no-price';
const VAS_JOB = 'vas-on-work-order';
const VAS_CLOSED = 'vas-closed-month';

describe.skipIf(!ready)('warehouse extra services and contract rates', () => {
  let org: TestOrg;
  let alone: TestOrg;
  let owner: DomainContext;
  let schema: string;
  let customerId: string;
  let clientId: string;
  let kitJobId: string;
  let flatJobId: string;
  let specialServiceId: string;

  interface Row {
    id: string;
    ref: string;
    day: string;
    quantity: string;
    unit_price: string | null;
    amount_cents: string | null;
    job_id: string | null;
    client_id: string;
    service: string;
    version: number;
    deleted: boolean;
  }
  const entries = (includeDeleted = false) =>
    org.query<Row>(
      `select v.id, v.source_ref as ref, v.work_date::text as day, v.quantity::text as quantity, v.unit_price::text as unit_price, v.amount_cents::text as amount_cents,
              v.job_id, v.client_id, s.name as service, v.version, (v.deleted_at is not null) as deleted
         from pulse.vas_entries v join pulse.vas_services s on s.id = v.vas_service_id
        where v.org_id = $1 and v.source = 'wms' ${includeDeleted ? '' : 'and v.deleted_at is null'} order by v.source_ref`,
      [org.orgId],
    );
  const entry = async (recordId: string): Promise<Row | undefined> => (await entries(true)).find((row) => row.ref === `wms:vas:${recordId}`);
  const sync = async () => {
    const [result] = await runSync(owner, 'wms');
    return result!;
  };

  beforeAll(async () => {
    org = await createTestOrg('pulse-wmsvas');
    alone = await createTestOrg('pulse-wmsvas-alone');
    owner = await org.member('owner', 'Service Owner');
    schema = `wms_${org.orgId.replace(/-/g, '')}`;
    customerId = randomUUID();
    await org.query(`insert into core.customers (id, org_id, code, name) values ($1, $2, 'VASC', 'Service Client')`, [customerId, org.orgId]);
    const q = (text: string, values?: unknown[]) => org.query(text.replaceAll('$S', `"${schema}"`), values);
    await q(`create schema $S`);
    await q(`create table $S.shipment_orders (id text primary key)`);
    await q(`create table $S.warehouses (id text primary key, timezone text)`);
    await q(`create table $S.clients (id text primary key, name text)`);
    await q(`create table $S.products (id text primary key, sku text, name text, purchase_price double precision)`);
    await q(`create table $S.purchase_order_lines (id text primary key, product_id text, unit_cost double precision, received_quantity integer, updated_at text)`);
    await q(
      `create table $S.work_orders (id text primary key, code text, status text, type text, extra_note text, client_id text, warehouse_id text, kit_product_id text,
         requested_qty integer, processed_qty integer, planned_finish_at text, actual_start_at text, actual_finish_at text)`,
    );
    await q(`create table $S.work_order_components (id text primary key, work_order_id text, component_product_id text, component_qty integer, total_qty integer, consumed_qty integer)`);
    await q(`create table $S.lookup_values (id text primary key, type text, name text)`);
    await q(
      `create table $S.vas_operations (id text primary key, client_id text, warehouse_id text, vas_type_id text, operation_at text, calculation_type text, value double precision,
         note text, reference_order_type text, reference_number text)`,
    );
    await q(`create table $S.billing_contracts (id text primary key, name text, client_id text, warehouse_id text, calc_start_date text, approval_status text)`);
    await q(
      `create table $S.billing_fees (id text primary key, contract_id text, operation_type text, fee_by text, vas_type_id text, standard_rate double precision,
         conditions jsonb not null default '[]'::jsonb, updated_at text)`,
    );
    // Volume tiers of a fee (empty until the tier test). Made here: Pulse keeps whether a table exists for a minute.
    await q(`create table $S.billing_fee_tiers (id text primary key, fee_id text, from_qty double precision, to_qty double precision, rate double precision, percentage double precision)`);
    await q(`insert into $S.warehouses values ($1, 'America/Chicago')`, [WAREHOUSE]);
    await q(`insert into $S.clients values ($1, 'Service Client')`, [customerId]);
    await q(`insert into $S.products values ('kit-1', 'KIT-1', 'Kit', 0), ('part-1', 'PART-1', 'Part', 0)`);
    await q(
      `insert into $S.work_orders values
         ($1, 'WO000501', 'In Process', 'Work Order with Picking', null, $3, $4, 'kit-1', 100, 0, null, null, null),
         ($2, 'WO000502', 'In Process', 'Work Order with Picking', null, $3, $4, 'kit-1', 50, 0, null, null, null)`,
      [WO_KIT, WO_FLAT, customerId, WAREHOUSE],
    );
    // Four parts in one kit, in two lines.
    await q(`insert into $S.work_order_components values ('wc-1', $1, 'part-1', 3, 300, 0), ('wc-2', $1, 'part-1', 1, 100, 0)`, [WO_KIT]);
    await q(`insert into $S.lookup_values values ($1, 'vas_type', 'Special Project'), ($2, 'vas_type', 'Programming (hours)'), ($3, 'vas_type', 'Grade B Pallet')`, [TYPE_PROJECT, TYPE_PROGRAM, TYPE_PALLET]);
    await q(`insert into $S.billing_contracts values ('contract-1', 'Service Client 2026', $1, $2, '2026-01-01', 'Approved'), ('contract-draft', 'Draft deal', $1, $2, '2026-01-01', 'Draft')`, [customerId, WAREHOUSE]);
    await q(
      `insert into $S.billing_fees values
         ('fee-program', 'contract-1', 'VAS', 'Operation', $1, 60, '[]', '2026-01-01T00:00:00.000Z'),
         ('fee-draft', 'contract-draft', 'VAS', 'Operation', $2, 999, '[]', '2026-01-01T00:00:00.000Z')`,
      [TYPE_PROGRAM, TYPE_PALLET],
    );
    await q(
      `insert into $S.vas_operations values
         ($1, $7, $8, $9, '2026-10-09T03:30:00.000Z', 'Total Price', 180, 'Re-bagged 300 tees', 'Purchase Order', null),
         ($2, $7, $8, $10, '2026-10-12T18:00:00.000Z', 'Vas Quantity', 3, 'Firmware flash', null, null),
         ($3, $7, $8, $10, '2026-10-13T18:00:00.000Z', 'Vas Quantity', 1.5, null, null, null),
         ($4, $7, $8, $11, '2026-10-16T18:00:00.000Z', 'Vas Quantity', 2, 'Pallet swap', null, null),
         ($5, $7, $8, $10, '2026-10-20T18:00:00.000Z', 'Vas Quantity', 2, 'Hubs for the kit', 'Work Order', 'WO000501'),
         ($6, $7, $8, $9, '2026-03-10T18:00:00.000Z', 'Total Price', 75, 'Old project', null, null)`,
      [VAS_OWN, VAS_RATE, VAS_FRACTION, VAS_NONE, VAS_JOB, VAS_CLOSED, customerId, WAREHOUSE, TYPE_PROJECT, TYPE_PROGRAM, TYPE_PALLET],
    );
    await org.query(`insert into core.wms_tenants (org_id, schema_name, status, created_at) values ($1, $2, 'active', now())`, [org.orgId, schema]);
    // The warehouse is set up before anything in Pulse asks for it (Pulse keeps the answer for a minute).
    const client = await createClient(owner, { name: 'Service Client', coreCustomerId: customerId });
    clientId = client.id;
    // A service typed in Pulse with the same name as the warehouse one: it is matched, not copied.
    specialServiceId = (await createVasService(owner, { code: 'SPECIAL', name: 'Special project', billing: 'per_hour', defaultPrice: '48.0000' })).id;
    const kit = await createJob(owner, { name: 'Kit build', clientId, status: 'active', plannedUnits: '100', unitPrice: '5.0000' });
    kitJobId = kit.id;
    await addJobLink(owner, kitJobId, { targetType: 'wms_work_order', targetId: WO_KIT, title: 'WO000501' });
    const flat = await createJob(owner, { name: 'Flat fee build', clientId, status: 'active', plannedUnits: '50', unitPrice: '1.0000' });
    flatJobId = flat.id;
    await addJobLink(owner, flatJobId, { targetType: 'wms_work_order', targetId: WO_FLAT, title: 'WO000502' });
    await saveProductionEntry(owner, { jobId: kitJobId, workDate: '2026-10-20', unitsGood: '10', headcount: '1', hours: '2' });
    // No warehouse parts in this test: the parts pull has its own suite.
    await org.query(`update pulse.settings set wms_sync_materials = false where org_id = $1`, [org.orgId]);
    await closePeriod(owner, '2026-03');
  }, 120_000);

  afterAll(async () => {
    if (org) {
      await org.query('delete from core.wms_tenants where org_id = $1', [org.orgId]).catch(() => undefined);
      await org.query(`drop schema if exists "${schema}" cascade`).catch(() => undefined);
      await org.query('delete from core.customers where org_id = $1', [org.orgId]).catch(() => undefined);
      await org.destroy();
    }
    await alone?.destroy();
  });

  it('does nothing when the workspace has no warehouse', async () => {
    const solo = await alone.member('owner', 'Solo Owner');
    expect(await listVasRecords(solo)).toBeNull();
    expect(await pullWmsServices(solo)).toMatchObject({ read: false, created: 0, updated: 0, removed: 0, records: 0 });
    const [result] = await runSync(solo, 'wms');
    expect(result).toMatchObject({ status: 'skipped', created: 0, updated: 0 });
    expect(await alone.query(`select 1 from pulse.vas_entries where org_id = $1`, [alone.orgId])).toHaveLength(0);
  }, 60_000);

  it('writes each record once, with the right cents, day, job and service', async () => {
    const result = await sync();
    expect(result.status).toBe('ok');
    const rows = await entries();
    expect(rows.map(({ ref, day, quantity, unit_price, amount_cents, service }) => ({ ref, day, quantity, unit_price, amount_cents, service }))).toEqual([
      { ref: `wms:vas:${VAS_RATE}`, day: '2026-10-12', quantity: '3.000', unit_price: '60.0000', amount_cents: '18000', service: 'Programming (hours)' },
      // 1.5 x $60.00 = $90.00.
      { ref: `wms:vas:${VAS_FRACTION}`, day: '2026-10-13', quantity: '1.500', unit_price: '60.0000', amount_cents: '9000', service: 'Programming (hours)' },
      // The contract for the pallet service is a draft, so it sets no price.
      { ref: `wms:vas:${VAS_NONE}`, day: '2026-10-16', quantity: '2.000', unit_price: null, amount_cents: null, service: 'Grade B Pallet' },
      { ref: `wms:vas:${VAS_JOB}`, day: '2026-10-20', quantity: '2.000', unit_price: '60.0000', amount_cents: '12000', service: 'Programming (hours)' },
      // Its own total, typed in the warehouse. 03:30 UTC on the 9th is still the 8th in Chicago.
      { ref: `wms:vas:${VAS_OWN}`, day: '2026-10-08', quantity: '1.000', unit_price: '180.0000', amount_cents: '18000', service: 'Special project' },
    ]);
    // The record that names a work order sits on that job. The others sit on the client.
    expect(rows.find((row) => row.ref === `wms:vas:${VAS_JOB}`)?.job_id).toBe(kitJobId);
    expect(rows.filter((row) => row.ref !== `wms:vas:${VAS_JOB}`).every((row) => row.job_id === null && row.client_id === clientId)).toBe(true);
    // The typed service was matched by name and now carries the warehouse id. The other two were made.
    const services = await org.query<{ id: string; name: string; source: string; wms_vas_type_id: string | null; billing: string; unit_label: string }>(
      `select id, name, source, wms_vas_type_id, billing, unit_label from pulse.vas_services where org_id = $1 and deleted_at is null order by name`,
      [org.orgId],
    );
    expect(services.map(({ name, source, wms_vas_type_id, billing, unit_label }) => ({ name, source, wms_vas_type_id, billing, unit_label }))).toEqual([
      { name: 'Grade B Pallet', source: 'wms', wms_vas_type_id: TYPE_PALLET, billing: 'per_unit', unit_label: 'units' },
      { name: 'Programming (hours)', source: 'wms', wms_vas_type_id: TYPE_PROGRAM, billing: 'per_unit', unit_label: 'hours' },
      { name: 'Special project', source: 'manual', wms_vas_type_id: TYPE_PROJECT, billing: 'per_hour', unit_label: 'units' },
    ]);
    expect(services.find((service) => service.name === 'Special project')?.id).toBe(specialServiceId);
    // The record in the closed month was left out and counted, not an error.
    expect(result.skippedClosed).toBe(1);
    expect(await entry(VAS_CLOSED)).toBeUndefined();
    const [state] = await org.query<{ counts: Record<string, number> }>(`select counts from pulse.sync_state where org_id = $1 and source = 'wms'`, [org.orgId]);
    expect(state?.counts).toMatchObject({ vasRecords: 6, vasInPulse: 5, vasNoPrice: 1, vasContractPriced: 3 });
    // Each entry carries the path back to the warehouse, and the reader gets a full link.
    const listed = await listVasEntries(owner, { clientId });
    expect(listed.filter((row) => row.source === 'wms').every((row) => row.sourceUrl?.endsWith('/billing/vas'))).toBe(true);
  }, 120_000);

  it('the money lands in job and client profit, and the rollups agree with the rows', async () => {
    const job = await getJobProfit(owner, kitJobId);
    expect(job.vasRevenueCents).toBe(12000);
    const [rollup] = await org.query<{ facts: string; rows: string; view: string }>(
      `select (select coalesce(sum(amount_cents), 0) from pulse.fact_days where org_id = $1 and kind = 'revenue_vas')::text as facts,
              (select coalesce(sum(amount_cents), 0) from pulse.vas_entries where org_id = $1 and deleted_at is null)::text as rows,
              (select coalesce(sum(amount_cents), 0) from pulse.v_facts where org_id = $1 and kind = 'revenue_vas')::text as view`,
      [org.orgId],
    );
    expect(rollup).toEqual({ facts: '57000', rows: '57000', view: '57000' });
    const [client] = await org.query<{ cents: string }>(`select coalesce(sum(amount_cents), 0)::text as cents from pulse.fact_days where org_id = $1 and client_id = $2 and kind = 'revenue_vas'`, [org.orgId, clientId]);
    expect(client?.cents).toBe('57000');
    const [stats] = await org.query<{ vas: string }>(`select vas_revenue_cents::text as vas from pulse.job_stats where org_id = $1 and job_id = $2`, [org.orgId, kitJobId]);
    expect(stats?.vas).toBe('12000');
  }, 60_000);

  it('a second sync adds nothing and changes nothing', async () => {
    const before = await entries(true);
    const again = await sync();
    expect(again).toMatchObject({ status: 'ok', created: 0, updated: 0 });
    expect(await entries(true)).toEqual(before);
  }, 60_000);

  it('a changed record and a changed contract rate update the entry in place', async () => {
    const before = await entry(VAS_OWN);
    await org.query(`update "${schema}".vas_operations set value = 200 where id = $1`, [VAS_OWN]);
    await org.query(`update "${schema}".billing_fees set standard_rate = 62.125 where id = 'fee-program'`);
    const result = await sync();
    expect(result.created).toBe(0);
    expect(result.updated).toBe(4);
    const own = await entry(VAS_OWN);
    expect(own).toMatchObject({ id: before?.id, amount_cents: '20000', unit_price: '200.0000' });
    expect(own?.version).toBe((before?.version ?? 0) + 1);
    // 3 x $62.125 = $186.375, rounded once to whole cents. 1.5 x $62.125 = $93.1875.
    expect(await entry(VAS_RATE)).toMatchObject({ amount_cents: '18638', unit_price: '62.1250' });
    expect(await entry(VAS_FRACTION)).toMatchObject({ amount_cents: '9319' });
    expect(await entry(VAS_JOB)).toMatchObject({ amount_cents: '12425' });
    expect((await getJobProfit(owner, kitJobId)).vasRevenueCents).toBe(12425);
  }, 60_000);

  it('falls back to the contract rate once the contract has one', async () => {
    expect(await entry(VAS_NONE)).toMatchObject({ amount_cents: null });
    await org.query(`insert into "${schema}".billing_fees values ('fee-pallet', 'contract-1', 'VAS', 'Operation', $1, 14.5, '[]', '2026-11-01T00:00:00.000Z')`, [TYPE_PALLET]);
    const result = await sync();
    expect(result.updated).toBe(1);
    expect(await entry(VAS_NONE)).toMatchObject({ amount_cents: '2900', unit_price: '14.5000' });
    const [state] = await org.query<{ counts: Record<string, number> }>(`select counts from pulse.sync_state where org_id = $1 and source = 'wms'`, [org.orgId]);
    expect(state?.counts).toMatchObject({ vasNoPrice: 0, vasContractPriced: 4 });
  }, 60_000);

  it('keeps what a person changed, and does not add back what a person deleted', async () => {
    const rate = await entry(VAS_RATE);
    const listed = (await listVasEntries(owner, { clientId })).find((row) => row.id === rate?.id);
    // A person types a price and labor hours on the pulled entry.
    await saveVasEntry(owner, { id: listed!.id, version: listed!.version, vasServiceId: listed!.vasServiceId, clientId, workDate: listed!.workDate, quantity: listed!.quantity, unitPrice: '70.0000', hours: '3' });
    // Labor hours typed on the entry with its own total: the amount stays the warehouse's, though the
    // matched Pulse service bills by the hour (3 hours at $200 would be a made up $600).
    const own = (await listVasEntries(owner, { clientId })).find((row) => row.sourceRef === `wms:vas:${VAS_OWN}`);
    const typed = await saveVasEntry(owner, { id: own!.id, version: own!.version, vasServiceId: own!.vasServiceId, clientId, workDate: own!.workDate, quantity: own!.quantity, unitPrice: own!.unitPrice, hours: '3' });
    expect(typed).toMatchObject({ amountCents: 20000, hours: '3.00' });
    const fraction = await entry(VAS_FRACTION);
    await deleteVasEntry(owner, fraction!.id);
    // The warehouse then changes the count on the first one.
    await org.query(`update "${schema}".vas_operations set value = 4 where id = $1`, [VAS_RATE]);
    const result = await sync();
    expect(result.created).toBe(0);
    // The new count comes in, the typed price and the hours stay: 4 x $70.00.
    const after = await org.query<{ quantity: string; unit_price: string; amount_cents: string; hours: string }>(`select quantity::text, unit_price::text, amount_cents::text, hours::text from pulse.vas_entries where id = $1`, [rate!.id]);
    expect(after[0]).toEqual({ quantity: '4.000', unit_price: '70.0000', amount_cents: '28000', hours: '3.00' });
    expect(await entry(VAS_OWN)).toMatchObject({ amount_cents: '20000', version: typed.version });
    expect((await entry(VAS_FRACTION))?.deleted).toBe(true);
    expect((await entries()).some((row) => row.ref === `wms:vas:${VAS_FRACTION}`)).toBe(false);
  }, 60_000);

  it('takes out an entry when the warehouse record is gone', async () => {
    await org.query(`delete from "${schema}".vas_operations where id = $1`, [VAS_NONE]);
    const result = await sync();
    expect(result.updated).toBe(1);
    expect((await entry(VAS_NONE))?.deleted).toBe(true);
    const [rollup] = await org.query<{ facts: string; rows: string }>(
      `select (select coalesce(sum(amount_cents), 0) from pulse.fact_days where org_id = $1 and kind = 'revenue_vas')::text as facts,
              (select coalesce(sum(amount_cents), 0) from pulse.vas_entries where org_id = $1 and deleted_at is null)::text as rows`,
      [org.orgId],
    );
    expect(rollup?.facts).toBe(rollup?.rows);
    expect(rollup?.rows).toBe(String(20000 + 28000 + 12425));
  }, 60_000);

  it('the contract rate for work orders sets the job price', async () => {
    // No work order fee yet: the price typed in Pulse stands.
    expect((await getJobProfit(owner, kitJobId)).baseRevenueCents).toBe(5000);
    await org.query(
      `insert into "${schema}".billing_fees values
         ('fee-kit', 'contract-1', 'Work Order', 'Per Kit', null, 4.25, '[{"field":"__pricingMode","value":"perUnit"}]', '2026-11-01T00:00:00.000Z'),
         ('fee-part', 'contract-1', 'Work Order', 'Per Component', null, 0.25, '[]', '2026-11-01T00:00:00.000Z')`,
    );
    // A contract that has not started yet is not read, even though it is the newest one.
    await org.query(`insert into "${schema}".billing_contracts values ('contract-next', 'Service Client next year', $1, $2, '2999-01-01', 'Approved')`, [customerId, WAREHOUSE]);
    await org.query(`insert into "${schema}".billing_fees values ('fee-kit-next', 'contract-next', 'Work Order', 'Per Kit', null, 77, '[]', '2026-11-01T00:00:00.000Z')`);
    const result = await sync();
    // Both linked jobs of this client follow the contract.
    expect(result).toMatchObject({ status: 'ok', updated: 2 });
    // The work order with no parts list earns the kit rate alone.
    expect((await listJobPrices(owner, flatJobId))[0]).toMatchObject({ unitPrice: '4.2500' });
    // $4.25 a kit plus $0.25 a part times 4 parts = $5.25. The pricing mode the warehouse keeps with the
    // conditions ("__pricingMode") is not a condition: the fee counts.
    // The job already had a price, so the contract rate starts today and the first price row stays.
    const prices = await listJobPrices(owner, kitJobId);
    expect(prices).toHaveLength(2);
    expect(prices[0]).toMatchObject({ unitPrice: '5.2500', note: 'Warehouse contract rate: Service Client 2026' });
    expect(prices[0]?.effectiveFrom).not.toBe('0001-01-01');
    expect(prices[1]).toMatchObject({ effectiveFrom: '0001-01-01', unitPrice: '5.0000' });
    // The 10 kits logged in October keep what they earned: the contract does not reach back.
    expect((await getJobProfit(owner, kitJobId)).baseRevenueCents).toBe(5000);
    // The job says where its price came from, with no amount in it.
    const [link] = (await getJob(owner, kitJobId)).links;
    expect(link?.priceFromContract).toMatchObject({ contractName: 'Service Client 2026', at: expect.any(String) });
    // A second sync changes nothing.
    expect(await sync()).toMatchObject({ created: 0, updated: 0 });
    expect(link?.contract).toMatchObject({ contractName: 'Service Client 2026', inEffect: true, billedBy: null, unitPrice: '5.2500' });
    // A price typed in Pulse afterwards is not fought over.
    await setJobPrice(owner, kitJobId, { effectiveFrom: '0001-01-01', unitPrice: '6.0000' });
    expect(await sync()).toMatchObject({ created: 0, updated: 0 });
    expect((await getJobProfit(owner, kitJobId)).baseRevenueCents).toBe(6000);
    // ...and the job stops saying its price came from the contract, and Connected apps counts it apart.
    const [typed] = (await getJob(owner, kitJobId)).links;
    expect(typed?.priceFromContract).toBeNull();
    expect(typed?.contract).toMatchObject({ inEffect: false, billedBy: null });
    const [typedState] = await org.query<{ counts: Record<string, number> }>(`select counts from pulse.sync_state where org_id = $1 and source = 'wms'`, [org.orgId]);
    expect(typedState?.counts).toMatchObject({ contractJobs: 1, contractTyped: 1, contractWarehouseBill: 0 });
    // When the contract rate changes, the contract wins again, from today on.
    await org.query(`update "${schema}".billing_fees set standard_rate = 4.5 where id = 'fee-kit'`);
    expect(await sync()).toMatchObject({ updated: 2 });
    const after = await listJobPrices(owner, kitJobId);
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ unitPrice: '5.5000' });
    expect(after[0]?.effectiveFrom).not.toBe('0001-01-01');
    // The kits from October keep the price that was in force then.
    expect((await getJobProfit(owner, kitJobId)).baseRevenueCents).toBe(6000);
    const [state] = await org.query<{ counts: Record<string, number> }>(`select counts from pulse.sync_state where org_id = $1 and source = 'wms'`, [org.orgId]);
    expect(state?.counts).toMatchObject({ contractJobs: 2, contractNotApplied: 0 });
  }, 120_000);

  it('fills in a job with no price from its first day, and leaves a finished job with a price alone', async () => {
    const q = (text: string, values?: unknown[]) => org.query(text.replaceAll('$S', `"${schema}"`), values);
    await q(
      `insert into $S.work_orders values
         ($1, 'WO000503', 'In Process', 'Work Order with Picking', null, $3, $4, 'kit-1', 20, 0, null, null, null),
         ($2, 'WO000504', 'Completed', 'Work Order with Picking', null, $3, $4, 'kit-1', 20, 20, null, null, null)`,
      [WO_NEW, WO_DONE, customerId, WAREHOUSE],
    );
    const fresh = await createJob(owner, { name: 'No price yet', clientId, status: 'active', plannedUnits: '20' });
    await addJobLink(owner, fresh.id, { targetType: 'wms_work_order', targetId: WO_NEW, title: 'WO000503' });
    await saveProductionEntry(owner, { jobId: fresh.id, workDate: '2026-10-21', unitsGood: '4', headcount: '1', hours: '1' });
    const done = await createJob(owner, { name: 'Finished with a price', clientId, status: 'active', plannedUnits: '20', unitPrice: '2.0000' });
    await addJobLink(owner, done.id, { targetType: 'wms_work_order', targetId: WO_DONE, title: 'WO000504' });
    await saveProductionEntry(owner, { jobId: done.id, workDate: '2026-10-22', unitsGood: '20', headcount: '1', hours: '4' });
    await setJobStatus(owner, done.id, 'completed');
    expect((await getJobProfit(owner, fresh.id)).baseRevenueCents).toBe(0);

    await sync();
    // No price yet: the kit rate ($4.50) counts from the first day, so the 4 kits already logged earn it.
    const freshPrices = await listJobPrices(owner, fresh.id);
    expect(freshPrices).toHaveLength(1);
    expect(freshPrices[0]).toMatchObject({ effectiveFrom: '0001-01-01', unitPrice: '4.5000', note: 'Warehouse contract rate: Service Client 2026' });
    expect((await getJobProfit(owner, fresh.id)).baseRevenueCents).toBe(1800);
    expect((await getJob(owner, fresh.id)).links[0]?.priceFromContract?.contractName).toBe('Service Client 2026');
    // Finished, with its own price: untouched, and not marked as priced by the contract.
    expect((await listJobPrices(owner, done.id)).map((price) => price.unitPrice)).toEqual(['2.0000']);
    expect((await getJobProfit(owner, done.id)).baseRevenueCents).toBe(4000);
    expect((await getJob(owner, done.id)).links[0]?.priceFromContract).toBeNull();
    const [state] = await org.query<{ counts: Record<string, number> }>(`select counts from pulse.sync_state where org_id = $1 and source = 'wms'`, [org.orgId]);
    // Three jobs follow the contract. The finished job keeps its own price and is counted apart.
    expect(state?.counts).toMatchObject({ contractJobs: 3, contractNotApplied: 1, contractTyped: 0 });
    // A reader with no money still sees where the price came from: a name and a day, no amount.
    expect(Object.keys((await getJob(owner, fresh.id)).links[0]?.priceFromContract ?? {}).sort()).toEqual(['at', 'contractName']);
  }, 120_000);

  it('the workspace can turn the contract rule off, and on again', async () => {
    expect((await getSettings(owner)).wmsContractPrices).toBe(true);
    await updateSettings(owner, { wmsContractPrices: false });
    await org.query(`update "${schema}".billing_fees set standard_rate = 8 where id = 'fee-kit'`);
    const off = await sync();
    expect(off).toMatchObject({ status: 'ok', updated: 0 });
    // Nothing moved: the prices are the ones from before the rate change.
    expect((await listJobPrices(owner, kitJobId))[0]).toMatchObject({ unitPrice: '5.5000' });
    expect((await listJobPrices(owner, flatJobId))[0]).toMatchObject({ unitPrice: '4.5000' });
    const [state] = await org.query<{ counts: Record<string, number> }>(`select counts from pulse.sync_state where org_id = $1 and source = 'wms'`, [org.orgId]);
    expect(state?.counts).toMatchObject({ contractJobs: 0 });
    expect((await getConnectedApps(owner)).switches.wmsContractPrices).toBe(false);
    // A price typed while the rule is off stays.
    await setJobPrice(owner, flatJobId, { unitPrice: '3.0000' });
    expect(await sync()).toMatchObject({ updated: 0 });
    expect((await listJobPrices(owner, flatJobId))[0]).toMatchObject({ unitPrice: '3.0000' });
    // On again: the contract has changed since Pulse last applied it, so it wins from today.
    await updateSettings(owner, { wmsContractPrices: true });
    await sync();
    expect((await listJobPrices(owner, kitJobId))[0]).toMatchObject({ unitPrice: '9.0000' });
    expect((await listJobPrices(owner, flatJobId))[0]).toMatchObject({ unitPrice: '8.0000' });
  }, 120_000);

  it('a contract with only a fee for each work order makes the job fixed price', async () => {
    await org.query(`delete from "${schema}".billing_fees where operation_type = 'Work Order'`);
    await org.query(`insert into "${schema}".billing_fees values ('fee-order', 'contract-1', 'Work Order', 'Per WorkOrder', null, 450, '[]', '2026-11-02T00:00:00.000Z')`);
    await sync();
    const [flat] = await org.query<{ pricing_model: string; fixed_price_cents: string }>(`select pricing_model, fixed_price_cents::text from pulse.jobs where id = $1`, [flatJobId]);
    expect(flat).toEqual({ pricing_model: 'fixed', fixed_price_cents: '45000' });
    // A fixed job earns by progress: 10 of 100 planned kits done is a tenth of the fee.
    const [kit] = await org.query<{ pricing_model: string }>(`select pricing_model from pulse.jobs where id = $1`, [kitJobId]);
    expect(kit?.pricing_model).toBe('fixed');
    expect((await getJobProfit(owner, kitJobId)).baseRevenueCents).toBe(4500);
    expect(await sync()).toMatchObject({ created: 0, updated: 0 });
  }, 60_000);

  it('reads a flat tier, and leaves volume tiers and fees with conditions to the warehouse bill', async () => {
    const q = (text: string, values?: unknown[]) => org.query(text.replaceAll('$S', `"${schema}"`), values);
    const WO_TIER = '11111111-1111-4111-8111-0000000000a5';
    await q(`insert into $S.work_orders values ($1, 'WO000505', 'In Process', 'Work Order with Picking', null, $2, $3, 'kit-1', 300, 0, null, null, null)`, [WO_TIER, customerId, WAREHOUSE]);
    const tiered = await createJob(owner, { name: 'Tiered build', clientId, status: 'active', plannedUnits: '300', unitPrice: '2.0000' });
    await addJobLink(owner, tiered.id, { targetType: 'wms_work_order', targetId: WO_TIER, title: 'WO000505' });
    await q(`delete from $S.billing_fees where operation_type = 'Work Order'`);
    const counts = async () => (await org.query<{ counts: Record<string, number> }>(`select counts from pulse.sync_state where org_id = $1 and source = 'wms'`, [org.orgId]))[0]?.counts ?? {};
    const tieredLink = async () => (await getJob(owner, tiered.id)).links[0];
    const price = async () => (await listJobPrices(owner, tiered.id))[0]?.unitPrice;

    // One tier: every unit at its rate, the way the warehouse bill charges it (the tier wins over the standard rate).
    await q(`insert into $S.billing_fees values ('fee-tier', 'contract-1', 'Work Order', 'Per Kit', null, 3, '[]', '2026-11-03T00:00:00.000Z')`);
    await q(`insert into $S.billing_fee_tiers values ('t-1', 'fee-tier', 1, null, 3.4, null)`);
    await sync();
    expect(await price()).toBe('3.4000');
    expect((await tieredLink())?.priceFromContract?.contractName).toBe('Service Client 2026');

    // Two tiers with different rates: the rate depends on the whole month of work orders. Pulse keeps
    // the job's price and says the warehouse bill prices it.
    await q(`update $S.billing_fee_tiers set to_qty = 100 where id = 't-1'`);
    await q(`insert into $S.billing_fee_tiers values ('t-2', 'fee-tier', 101, null, 3.1, null)`);
    await sync();
    expect(await price()).toBe('3.4000');
    expect(await tieredLink()).toMatchObject({ priceFromContract: null, contract: { billedBy: 'tiers', inEffect: false, unitPrice: null } });
    expect(await counts()).toMatchObject({ contractWarehouseBill: expect.any(Number) });
    expect((await counts()).contractWarehouseBill).toBeGreaterThanOrEqual(1);
    // A second sync does not touch it again.
    expect(await sync()).toMatchObject({ updated: 0 });

    // Two tiers at the same rate, from the first unit with no gap: one rate for every unit again.
    await q(`update $S.billing_fee_tiers set rate = 3.4 where id = 't-2'`);
    await sync();
    expect(await price()).toBe('3.4000');
    expect(await tieredLink()).toMatchObject({ priceFromContract: { contractName: 'Service Client 2026' }, contract: { billedBy: null, inEffect: true } });

    // "From quantity" that skips the first 50 units of each billing period: only the bill knows.
    await q(`delete from $S.billing_fee_tiers where id = 't-2'`);
    await q(`update $S.billing_fee_tiers set from_qty = 51, to_qty = null, rate = 3.9 where id = 't-1'`);
    await q(`update $S.billing_fees set conditions = '[{"field":"__pricingMode","value":"fromQuantity"}]' where id = 'fee-tier'`);
    await sync();
    expect(await price()).toBe('3.4000');
    expect((await tieredLink())?.contract?.billedBy).toBe('tiers');
    // "For each unit" uses the first tier's rate for every unit, whatever its start.
    await q(`update $S.billing_fees set conditions = '[{"field":"__pricingMode","value":"perUnit"}]' where id = 'fee-tier'`);
    await sync();
    expect(await price()).toBe('3.9000');

    // A fee for some products only ("Charge if"): Pulse cannot tell whether this job is one of them.
    await q(`insert into $S.billing_fees values ('fee-cond', 'contract-1', 'Work Order', 'Per Component', null, 0.1, '[{"field":"productType","comparator":"in","value":["Gift"]}]', '2026-11-03T00:00:00.000Z')`);
    await sync();
    expect(await price()).toBe('3.9000');
    expect((await tieredLink())?.contract?.billedBy).toBe('conditions');

    // An extra service whose contract fee has volume tiers gets no price: only the bill can price it.
    await q(`insert into $S.billing_fee_tiers values ('t-vas-1', 'fee-program', 1, 5, 60, null), ('t-vas-2', 'fee-program', 6, null, 50, null)`);
    const records = (await listVasRecords(owner)) ?? [];
    expect(records.find((record) => record.id === VAS_RATE)).toMatchObject({ priceFrom: 'warehouse_bill', billedBy: 'tiers', unitPrice: null, contractName: 'Service Client 2026' });
    expect(records.find((record) => record.id === VAS_OWN)).toMatchObject({ priceFrom: 'record' });
    await sync();
    expect((await entry(VAS_RATE))?.amount_cents).toBeNull();
    expect(await counts()).toMatchObject({ vasWarehouseBill: expect.any(Number) });
    expect((await counts()).vasWarehouseBill).toBeGreaterThanOrEqual(1);
    await q(`delete from $S.billing_fee_tiers where fee_id = 'fee-program'`);
  }, 120_000);
});
