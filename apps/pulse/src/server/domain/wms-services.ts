/**
 * Warehouse money into Pulse (SPEC 8.3): the warehouse's extra service (VAS) records become
 * extra service entries, and the warehouse contract's work order rates set job prices.
 *
 * Extra services
 *  - One Pulse entry per warehouse record, `source = 'wms'`, `source_ref = wms:vas:<record id>`.
 *    A second pull changes nothing; a changed record updates its entry; a record that is gone is
 *    taken out (soft delete). Months that are closed are left alone and counted.
 *  - The entry sits on the job linked to the record's work order, else on the client.
 *  - Price: the record's own total when it has one, else quantity times the client's contract
 *    rate for that service, else no price yet. Cents come from `mulQuantityPrice` (BigInt).
 *  - The warehouse service is matched to a Pulse extra service by its stored warehouse id, then
 *    by name or code, and a new Pulse service is made when there is no match.
 *  - What a person changed on a pulled entry (`meta.locked_fields`) is never overwritten, and an
 *    entry a person deleted in Pulse is not added back.
 *
 * Contract rates
 *  - A job linked to a work order takes its price from the "Work Order" fees on the client's
 *    approved warehouse contract. "Per Kit" plus "Per Component" times the parts in one kit is
 *    the unit price of a per unit job. A contract with only a "Per WorkOrder" fee makes the job
 *    fixed price at that fee.
 *  - The contract wins when Pulse first sees it and each time its rates change. A price a person
 *    types in Pulse after that stays until the contract changes again.
 *  - The contract never rewrites what a job already earned. A job with no price yet takes the
 *    rate from its first day. A job that already has a price keeps it for the days behind it: the
 *    contract rate starts today. A completed job that already has a price is left alone.
 *  - Only a contract that has started is read (`listContractPrices`).
 *  - The workspace can turn the whole rule off: "Let warehouse contract rates set job prices" on
 *    Connected apps (`settings.wmsContractPrices`, on by default). The sync then skips this step.
 *  - The link keeps what was applied (`meta.contractPrice`, `contractName`, `contractPriceAt`),
 *    and the job page says the price came from the contract.
 *
 * Everything is fail soft: with no warehouse to read, both calls do nothing.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { vasServices } from '@/server/db/schema';
import { isDomainError } from '@/server/errors';
import { logSoftFail } from '@/server/integrations/log';
import { listContractPrices, listVasRecords, type WmsVasRecord } from '@/server/integrations/wms';
import { mulQuantityPrice } from '@/lib/money';
import { cleanText, inTx, monthStart, rows, type DomainContext } from './_shared';
import { codeFromName, freeCode } from './_crud';
import { requirePulse } from './access';
import { logActivity } from './activity';
import { deleteVasEntry, saveVasEntry } from './entries';
import { setJobPrice, updateJob } from './jobs';
import { closedMonths } from './recalc';

/** Stable ref of the Pulse entry for one warehouse extra service record. */
export const wmsVasRef = (recordId: string): string => `wms:vas:${recordId}`;
const serviceRef = (vasTypeId: string): string => `wms:vas_type:${vasTypeId}`;

const isClosedMonth = (error: unknown): boolean => isDomainError(error) && /closed/i.test(error.message);
const plain = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const MAX_CENTS = BigInt('10000000000000');

export interface WmsServicesResult {
  /** False when there is no warehouse to read: nothing was looked at and nothing was changed. */
  read: boolean;
  created: number;
  updated: number;
  removed: number;
  skipped: number;
  skippedClosed: number;
  /** Records in the warehouse. */
  records: number;
  /** Records that still earn nothing, because neither the record nor the contract has a price. */
  noPrice: number;
  /** Records priced by the client's contract rate. */
  contractPriced: number;
  /** Records whose client is not in Pulse yet. */
  noClient: number;
  /** Live entries in Pulse that came from the warehouse, after this pull. */
  inPulse: number;
}

interface ServiceLite {
  id: string;
  code: string;
  name: string;
  wmsVasTypeId: string | null;
}

interface EntryLite {
  id: string;
  version: number;
  vas_service_id: string;
  client_id: string;
  job_id: string | null;
  work_date: string;
  quantity: string;
  unit_price: string | null;
  amount_cents: string | null;
  hours: string;
  note: string | null;
  source_ref: string;
  meta: Record<string, unknown> | null;
  deleted: boolean;
}

const lockedOf = (row: EntryLite | undefined): string[] => (row && Array.isArray(row.meta?.locked_fields) ? (row.meta?.locked_fields as string[]) : []);
const sameNumber = (a: string | null, b: string | null): boolean => (a === null || b === null ? a === b : Number(a) === Number(b));

/**
 * The Pulse extra service for a warehouse service: the one that already carries its warehouse
 * id, else the single service with the same name or code (it then gets the id), else a new one.
 */
async function ensureService(ctx: DomainContext, record: WmsVasRecord, services: ServiceLite[]): Promise<string> {
  const known = services.find((service) => service.wmsVasTypeId === record.vasTypeId);
  if (known) return known.id;
  const wanted = plain(record.vasType);
  const matches = services.filter((service) => service.wmsVasTypeId === null && (plain(service.name) === wanted || plain(service.code) === wanted));
  if (matches.length === 1) {
    const match = matches[0]!;
    await inTx(async (tx) => {
      await tx.execute(sql`UPDATE pulse.vas_services SET wms_vas_type_id = ${record.vasTypeId}, version = version + 1, updated_by = ${ctx.userId}, updated_at = now() WHERE id = ${match.id} AND org_id = ${ctx.orgId}`);
      await logActivity(tx, ctx, { verb: 'service.updated', entityType: 'service', entityId: match.id, field: 'wmsVasTypeId', before: null, after: record.vasTypeId, meta: { warehouseService: record.vasType } });
    });
    match.wmsVasTypeId = record.vasTypeId;
    return match.id;
  }
  const name = cleanText(record.vasType) ?? 'Warehouse service';
  const created = await inTx(async (tx) => {
    const code = await freeCode(tx, ctx.orgId, 'vas_services', codeFromName(name));
    const [row] = await tx
      .insert(vasServices)
      .values({
        orgId: ctx.orgId,
        code,
        name,
        // A record with its own total is a flat price. A counted one is priced by the contract, per unit.
        billing: record.priceFrom === 'record' ? 'flat' : 'per_unit',
        unitLabel: record.priceFrom === 'record' ? 'jobs' : /\bhours?\b/i.test(name) ? 'hours' : 'units',
        wmsVasTypeId: record.vasTypeId,
        source: 'wms',
        sourceRef: serviceRef(record.vasTypeId),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    await logActivity(tx, ctx, { verb: 'service.created', entityType: 'service', entityId: row!.id, after: { code, name }, meta: { wmsVasTypeId: record.vasTypeId } });
    return row!;
  });
  services.push({ id: created.id, code: created.code, name: created.name, wmsVasTypeId: record.vasTypeId });
  return created.id;
}

/**
 * Pulls the warehouse's extra service records into `pulse.vas_entries`. Safe to run again.
 * Never throws for a warehouse that is missing or cannot be read: it answers `read: false`.
 */
export const pullWmsServices = scoped(async function pullWmsServices(ctx: DomainContext): Promise<WmsServicesResult> {
  await requirePulse(ctx, 'vas:manage');
  const result: WmsServicesResult = { read: false, created: 0, updated: 0, removed: 0, skipped: 0, skippedClosed: 0, records: 0, noPrice: 0, contractPriced: 0, noClient: 0, inPulse: 0 };
  let records: WmsVasRecord[] | null;
  try {
    // Strict read: entries are taken out below when their record is gone, so a failed read must not look like "no records".
    records = await listVasRecords(ctx, { throwOnError: true });
  } catch {
    return result;
  }
  if (records === null) return result;
  result.records = records.length;

  const [clients, sites, links, services, existing, closed] = await Promise.all([
    rows<{ id: string; core_customer_id: string }>(db, sql`SELECT id, core_customer_id::text AS core_customer_id FROM pulse.clients WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND core_customer_id IS NOT NULL`),
    rows<{ id: string; wms_warehouse_id: string }>(db, sql`SELECT id, wms_warehouse_id FROM pulse.sites WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND wms_warehouse_id IS NOT NULL`),
    rows<{ target_id: string; job_id: string; client_id: string }>(
      db,
      sql`SELECT l.target_id, j.id AS job_id, j.client_id FROM pulse.job_links l JOIN pulse.jobs j ON j.id = l.job_id AND j.deleted_at IS NULL
           WHERE l.org_id = ${ctx.orgId} AND l.target_type = 'wms_work_order' ORDER BY l.created_at`,
    ),
    rows<ServiceLite>(db, sql`SELECT id, code, name, wms_vas_type_id AS "wmsVasTypeId" FROM pulse.vas_services WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL ORDER BY created_at`),
    rows<EntryLite>(
      db,
      sql`SELECT id, version, vas_service_id, client_id, job_id, work_date::text AS work_date, quantity::text AS quantity, unit_price::text AS unit_price,
                 amount_cents::text AS amount_cents, hours::text AS hours, note, source_ref, meta, (deleted_at IS NOT NULL) AS deleted
            FROM pulse.vas_entries WHERE org_id = ${ctx.orgId} AND source = 'wms' AND source_ref LIKE 'wms:vas:%'
           ORDER BY deleted_at NULLS LAST`,
    ),
    closedMonths(db, ctx.orgId),
  ]);
  result.read = true;
  const clientByCustomer = new Map(clients.map((client) => [client.core_customer_id, client.id]));
  const siteByWarehouse = new Map(sites.map((site) => [site.wms_warehouse_id, site.id]));
  // One work order feeds one job: the oldest link wins.
  const jobByOrder = new Map<string, { jobId: string; clientId: string }>();
  for (const link of links) if (!jobByOrder.has(link.target_id)) jobByOrder.set(link.target_id, { jobId: link.job_id, clientId: link.client_id });
  // A live entry wins over a deleted one with the same ref (deleted rows sort first, so they are overwritten).
  const byRef = new Map(existing.map((row) => [row.source_ref, row]));
  const isClosed = (date: string): boolean => closed.has(monthStart(date));
  const seen = new Set<string>();

  for (const record of records) {
    const ref = wmsVasRef(record.id);
    seen.add(ref);
    const have = byRef.get(ref);
    const job = record.workOrderId ? jobByOrder.get(record.workOrderId) : undefined;
    const clientId = job?.clientId ?? clientByCustomer.get(record.clientId);
    if (!clientId) {
      result.noClient += 1;
      result.skipped += 1;
      continue;
    }
    // A person took this entry out in Pulse. It is not added back.
    if (have?.deleted) continue;
    try {
      const locked = lockedOf(have);
      const priceLocked = Boolean(have) && (locked.includes('unitPrice') || locked.includes('amountCents'));
      const quantity = have && locked.includes('quantity') ? have.quantity : record.quantity;
      const amount = record.priceFrom === 'record' && record.ownCents !== null ? BigInt(record.ownCents) : record.priceFrom === 'contract' && record.unitPrice !== null ? mulQuantityPrice(quantity, record.unitPrice) : null;
      if (amount !== null && amount > MAX_CENTS) {
        result.skipped += 1;
        continue;
      }
      if (priceLocked ? have?.amount_cents === null : amount === null) result.noPrice += 1;
      else if (!priceLocked && record.priceFrom === 'contract') result.contractPriced += 1;
      const keepTarget = Boolean(have) && (locked.includes('jobId') || locked.includes('clientId'));
      const wanted = {
        vasServiceId: have && locked.includes('vasServiceId') ? have.vas_service_id : await ensureService(ctx, record, services),
        jobId: keepTarget ? (have?.job_id ?? null) : (job?.jobId ?? null),
        clientId: keepTarget ? (have?.client_id ?? clientId) : clientId,
        workDate: have && locked.includes('workDate') ? have.work_date : record.workDate,
        quantity,
        note: have && locked.includes('note') ? have.note : cleanText(record.note),
      };
      if (have) {
        const same =
          have.vas_service_id === wanted.vasServiceId &&
          have.job_id === wanted.jobId &&
          have.client_id === wanted.clientId &&
          have.work_date === wanted.workDate &&
          sameNumber(have.quantity, wanted.quantity) &&
          have.note === wanted.note &&
          (priceLocked || (sameNumber(have.unit_price, record.unitPrice) && (have.amount_cents === null ? amount === null : amount !== null && BigInt(have.amount_cents) === amount)));
        if (same) continue;
      }
      if (isClosed(wanted.workDate) || (have && isClosed(have.work_date))) {
        result.skippedClosed += 1;
        continue;
      }
      await saveVasEntry(ctx, {
        id: have?.id ?? null,
        version: have?.version,
        vasServiceId: wanted.vasServiceId,
        jobId: wanted.jobId,
        clientId: wanted.jobId ? null : wanted.clientId,
        siteId: have ? undefined : (record.warehouseId ? siteByWarehouse.get(record.warehouseId) : undefined),
        workDate: wanted.workDate,
        quantity: wanted.quantity,
        // A price a person typed stays (left out means "keep it" and the amount is worked out again).
        unitPrice: priceLocked ? undefined : record.unitPrice,
        amountCents: priceLocked ? undefined : amount === null ? null : Number(amount),
        // Labor on a pulled entry is typed in Pulse: keep it.
        hours: have?.hours,
        note: wanted.note,
        source: 'wms',
        sourceRef: ref,
        meta: { wms: { vasOperationId: record.id, path: record.path, priceFrom: record.priceFrom, contractName: record.contractName } },
      });
      if (have) result.updated += 1;
      else result.created += 1;
    } catch (error) {
      if (isClosedMonth(error)) result.skippedClosed += 1;
      else {
        result.skipped += 1;
        logSoftFail(ctx.orgId, 'wms-services.pullWmsServices', error);
      }
    }
  }

  // A record the warehouse deleted is taken out of Pulse too (open months only).
  for (const row of existing) {
    if (row.deleted || seen.has(row.source_ref)) continue;
    if (isClosed(row.work_date)) {
      result.skippedClosed += 1;
      continue;
    }
    try {
      await deleteVasEntry(ctx, row.id);
      result.removed += 1;
    } catch (error) {
      if (isClosedMonth(error)) result.skippedClosed += 1;
      else {
        result.skipped += 1;
        logSoftFail(ctx.orgId, 'wms-services.pullWmsServices.remove', error);
      }
    }
  }

  const [live] = await rows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM pulse.vas_entries WHERE org_id = ${ctx.orgId} AND source = 'wms' AND source_ref LIKE 'wms:vas:%' AND deleted_at IS NULL`);
  result.inPulse = live?.n ?? 0;
  return result;
});

export interface ContractPriceResult {
  /** Jobs whose price was set from the contract in this run. */
  updated: number;
  skipped: number;
  skippedClosed: number;
  /** Linked jobs whose client has a contract rate for work orders. */
  jobs: number;
  /** Jobs the contract could not price, because the job is priced another way (hourly, or fixed against a unit rate). */
  notApplied: number;
}

/** A link between a job and a work order, as the sync already holds it. */
export interface ContractLink {
  readonly link_id: string;
  readonly job_id: string;
  readonly job_status: string;
  readonly target_id: string;
  readonly meta: Record<string, unknown> | null;
}

/**
 * Sets the price of each linked job from the warehouse contract's work order rates. The contract
 * is applied once per set of rates (kept on the link as `meta.contractPrice`), so a price typed
 * in Pulse later is not fought over. The first time, a job with no price takes the rate on its
 * first price row (every open month is restamped). A job that already has a price, and every
 * later rate change, starts a new dated price from today. A completed job that already has a
 * price is left alone. Closed months never change. The sync skips this whole step when the
 * workspace turned off "Let warehouse contract rates set job prices".
 */
export const applyWmsContractPrices = scoped(async function applyWmsContractPrices(ctx: DomainContext, links: readonly ContractLink[]): Promise<ContractPriceResult> {
  await requirePulse(ctx, 'revenue:manage');
  const result: ContractPriceResult = { updated: 0, skipped: 0, skippedClosed: 0, jobs: 0, notApplied: 0 };
  // One work order feeds one job: the oldest link wins.
  const first = new Map<string, ContractLink>();
  for (const link of links) if (!first.has(link.target_id) && link.job_status !== 'cancelled') first.set(link.target_id, link);
  if (first.size === 0) return result;
  const prices = await listContractPrices(ctx, [...first.keys()]);
  if (prices.length === 0) return result;
  const jobs = await rows<{ id: string; status: string; pricing_model: string; unit_price: string | null; fixed_price_cents: string | null }>(
    db,
    sql`SELECT id, status, pricing_model, unit_price::text AS unit_price, fixed_price_cents::text AS fixed_price_cents FROM pulse.jobs
         WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND id IN (${sql.join([...first.values()].map((link) => sql`${link.job_id}`), sql`, `)})`,
  );
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  for (const price of prices) {
    const link = first.get(price.workOrderId);
    const job = link ? jobById.get(link.job_id) : undefined;
    if (!link || !job) continue;
    result.jobs += 1;
    if (link.meta?.contractPrice === price.signature) continue;
    const firstTime = typeof link.meta?.contractPrice !== 'string';
    const note = `Warehouse contract rate: ${price.contractName}`.slice(0, 200);
    // What the job earns today, before the contract: a unit price, or a fixed price.
    const hasPrice = job.pricing_model === 'fixed' ? job.fixed_price_cents !== null && Number(job.fixed_price_cents) > 0 : job.unit_price !== null && Number(job.unit_price) > 0;
    try {
      if (firstTime && hasPrice && job.status === 'completed') {
        // A finished job that already has a price: the contract does not reach back into it.
        result.notApplied += 1;
        continue;
      }
      if (price.unitPrice !== null && job.pricing_model === 'per_unit') {
        if (!sameNumber(job.unit_price, price.unitPrice)) {
          // No price yet: the rate counts from the job's first day. A price already there keeps the days behind it.
          await setJobPrice(ctx, job.id, firstTime && !hasPrice ? { effectiveFrom: '0001-01-01', unitPrice: price.unitPrice, note } : { unitPrice: price.unitPrice, note });
          result.updated += 1;
        }
      } else if (price.unitPrice === null && price.perOrderCents !== null && job.pricing_model !== 'hourly') {
        if (job.pricing_model !== 'fixed' || job.fixed_price_cents === null || Number(job.fixed_price_cents) !== price.perOrderCents) {
          await updateJob(ctx, job.id, { pricingModel: 'fixed', fixedPriceCents: price.perOrderCents });
          result.updated += 1;
        }
      } else {
        // An hourly job, or a fixed price job against a unit rate: the contract does not fit, so the Pulse price stays.
        result.notApplied += 1;
        continue;
      }
      await db.execute(
        sql`UPDATE pulse.job_links SET meta = meta || ${JSON.stringify({ contractPrice: price.signature, contractName: price.contractName, contractUnitPrice: price.unitPrice, contractFixedCents: price.unitPrice === null ? price.perOrderCents : null, contractPriceAt: new Date().toISOString() })}::jsonb, updated_at = now()
             WHERE id = ${link.link_id} AND org_id = ${ctx.orgId}`,
      );
    } catch (error) {
      if (isClosedMonth(error)) result.skippedClosed += 1;
      else {
        result.skipped += 1;
        logSoftFail(ctx.orgId, 'wms-services.applyWmsContractPrices', error);
      }
    }
  }
  return result;
});
