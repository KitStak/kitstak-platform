/**
 * Sibling sync (SPEC section 8): pull from CRM, the warehouse and Projects into Pulse rows, and
 * keep the copies on job links fresh. Every pull is safe to run again and never counts a thing
 * twice:
 *
 *  - Each pulled stream row carries a `source_ref` that names the thing it came from
 *    (`wms:built:<workOrderId>:<date>`, `wms:bill:<reportId>:<operation>`,
 *    `wms:vas:<recordId>`, `pm:<projectId>:<date>`). A run looks the ref up first and only adds
 *    what is missing.
 *  - Warehouse extra services and contract rates are in `wms-services.ts`.
 *  - A day a person already typed is adopted (it gets the ref), not added a second time.
 *  - A field a person changed on a pulled row is listed in `meta.locked_fields` and is left alone.
 *  - A project's time feeds one job only, even when two jobs link the same project.
 *  - Rows dated in a closed month are counted as skipped, never written and never an error.
 *  - One run per workspace and app at a time: a run takes a five minute lease on `sync_state`.
 *
 * Nothing here needs a sibling app. When an app is not on the plan, not installed, or cannot be
 * read, its sync is skipped quietly and Pulse keeps working.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { appUrls } from '@/server/env';
import { orgModuleFlags } from '@/server/entitlements';
import { integrationAvailability } from '@/server/integrations/detect';
import { getAccounts, getDeals, listWonDeals } from '@/server/integrations/crm';
import { getProjects, projectTimeByDay } from '@/server/integrations/projects';
import { listBilledRevenue, listWorkOrders, workOrderBuildsByDay } from '@/server/integrations/wms';
import { logSoftFail } from '@/server/integrations/log';
import { isDomainError } from '@/server/errors';
import type { LinkTargetType } from '@/lib/constants';
import type { AppConnectionDTO, ConnectedAppsDTO, LinkedJobDTO, SiblingApp, SyncResultDTO, SyncRunDTO } from '@/features/integrations/types';
import { inTx, monthStart, rows, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { logActivity } from './activity';
import { deleteRevenue, saveRevenue } from './entries';
import { recomputeJobs } from './job-stats';
import { setJobStatus } from './jobs';
import { pullWmsUsage } from './ledger';
import { deleteProductionEntries, saveProductionEntry } from './production';
import { assertOpen, closedMonths, finishWrite, newTouched, restampFixedJob, restampProduction, touchDay, touchJob } from './recalc';
import { loadSettings } from './settings';
import { applyWmsContractPrices, pullWmsServices } from './wms-services';

const SOURCES: readonly SiblingApp[] = ['crm', 'wms', 'projects'];
type Trigger = 'manual' | 'page' | 'event' | 'cron';

/** A sync older than this is refreshed in the background on a page load. */
export const SYNC_STALE_MINUTES = 10;
const LEASE_MINUTES = 5;

interface Tally {
  created: number;
  updated: number;
  skipped: number;
  skippedClosed: number;
  counts: Record<string, number>;
}

const newTally = (): Tally => ({ created: 0, updated: 0, skipped: 0, skippedClosed: 0, counts: {} });

/** The same person on the audit line, acting as the integration (treated as the workspace owner). */
const asIntegration = (ctx: DomainContext): DomainContext => ({ ...ctx, actorKind: 'integration' });

const isClosedMonth = (error: unknown): boolean => isDomainError(error) && /closed/i.test(error.message);

/* ------------------------------------------------------------------ links */

interface LinkRow {
  link_id: string;
  job_id: string;
  job_number: string;
  job_name: string;
  job_status: string;
  client_id: string | null;
  site_id: string;
  timezone: string;
  pricing_model: string;
  default_labor_class_id: string | null;
  wms_shortage: boolean;
  target_type: LinkTargetType;
  target_id: string;
  imports_time: boolean;
  cached_title: string | null;
  cached_status: string | null;
  cached_url: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

async function linkRows(ctx: DomainContext, types: readonly LinkTargetType[]): Promise<LinkRow[]> {
  return rows<LinkRow>(
    db,
    sql`SELECT l.id AS link_id, j.id AS job_id, j.number AS job_number, j.name AS job_name, j.status AS job_status, j.client_id, j.site_id, s.timezone,
               j.pricing_model, j.default_labor_class_id, j.wms_shortage, l.target_type, l.target_id, l.imports_time,
               l.cached_title, l.cached_status, l.cached_url, l.meta, l.created_at::text AS created_at
          FROM pulse.job_links l
          JOIN pulse.jobs j ON j.id = l.job_id AND j.deleted_at IS NULL
          JOIN pulse.sites s ON s.id = j.site_id
         WHERE l.org_id = ${ctx.orgId} AND l.target_type IN (${sql.join(types.map((type) => sql`${type}`), sql`, `)})
         ORDER BY l.created_at`,
  );
}

/** Writes the fresh copy of a record onto its link when anything changed. Returns true when it did. */
async function refreshLink(ctx: DomainContext, link: LinkRow, fresh: { title: string | null; status: string | null; path: string | null; meta?: Record<string, unknown> }): Promise<boolean> {
  const meta = { ...(link.meta ?? {}), ...(fresh.meta ?? {}) };
  const same = link.cached_title === fresh.title && link.cached_status === fresh.status && link.cached_url === fresh.path && JSON.stringify(link.meta ?? {}) === JSON.stringify(meta);
  if (same) {
    await db.execute(sql`UPDATE pulse.job_links SET cached_at = now() WHERE id = ${link.link_id} AND org_id = ${ctx.orgId}`);
    return false;
  }
  await db.execute(
    sql`UPDATE pulse.job_links SET cached_title = ${fresh.title}, cached_status = ${fresh.status}, cached_url = ${fresh.path}, meta = ${JSON.stringify(meta)}::jsonb, cached_at = now(), updated_at = now()
         WHERE id = ${link.link_id} AND org_id = ${ctx.orgId}`,
  );
  return true;
}

/* ------------------------------------------------------- pulled work rows */

interface EntryRow {
  id: string;
  job_id: string;
  site_id: string;
  work_date: string;
  units_good: string;
  hours: string;
  headcount: string | null;
  source: string;
  source_ref: string | null;
  meta: Record<string, unknown> | null;
}

const ENTRY_COLUMNS = sql`e.id, e.job_id, e.site_id, e.work_date::text AS work_date, e.units_good::text AS units_good, e.hours::text AS hours, e.headcount::text AS headcount, e.source, e.source_ref, e.meta`;

const lockedFields = (row: EntryRow): string[] => (Array.isArray(row.meta?.locked_fields) ? (row.meta?.locked_fields as string[]) : []);
const sameNumber = (a: string | null, b: string | null): boolean => Number(a ?? 0) === Number(b ?? 0);

/**
 * Changes a pulled work row in place (units, hours, people or its ref), then restamps it and
 * refreshes the rollups, like every other stream write. Does not mark the fields as changed by
 * a person, so the next pull may update them again.
 */
async function updatePulledEntry(ctx: DomainContext, link: LinkRow, row: EntryRow, patch: { unitsGood?: string; hours?: string; headcount?: string; sourceRef?: string; adoptedFrom?: SiblingApp }): Promise<void> {
  await inTx(async (tx) => {
    await assertOpen(tx, ctx.orgId, [row.work_date]);
    const meta = patch.adoptedFrom ? { ...(row.meta ?? {}), adopted_from: patch.adoptedFrom } : (row.meta ?? {});
    await tx.execute(
      sql`UPDATE pulse.production_entries
             SET units_good = COALESCE(${patch.unitsGood ?? null}::numeric, units_good),
                 hours = COALESCE(${patch.hours ?? null}::numeric, hours),
                 headcount = COALESCE(${patch.headcount ?? null}::numeric, headcount),
                 hours_confirmed = CASE WHEN ${patch.hours ?? null}::numeric IS NOT NULL THEN true ELSE hours_confirmed END,
                 source_ref = COALESCE(${patch.sourceRef ?? null}, source_ref),
                 meta = ${JSON.stringify(meta)}::jsonb, version = version + 1, updated_by = ${ctx.userId}, updated_at = now()
           WHERE id = ${row.id} AND org_id = ${ctx.orgId}`,
    );
    await logActivity(tx, ctx, {
      verb: patch.adoptedFrom ? 'sync.adopted' : 'sync.updated',
      entityType: 'production',
      entityId: row.id,
      jobId: row.job_id,
      clientId: link.client_id,
      before: { unitsGood: row.units_good, hours: row.hours, headcount: row.headcount },
      after: { unitsGood: patch.unitsGood ?? row.units_good, hours: patch.hours ?? row.hours, headcount: patch.headcount ?? row.headcount },
      meta: { workDate: row.work_date, sourceRef: patch.sourceRef ?? row.source_ref },
    });
    await restampProduction(tx, ctx.orgId, sql`src.id = ${row.id}`);
    if (link.pricing_model === 'fixed') await restampFixedJob(tx, ctx, row.job_id);
    const touched = newTouched();
    touchDay(touched, row.site_id, row.work_date);
    touchJob(touched, row.job_id, link.client_id);
    await finishWrite(tx, ctx, touched);
  });
}

async function entryByRef(ctx: DomainContext, ref: string): Promise<EntryRow | undefined> {
  const [row] = await rows<EntryRow>(db, sql`SELECT ${ENTRY_COLUMNS} FROM pulse.production_entries e WHERE e.org_id = ${ctx.orgId} AND e.source_ref = ${ref} AND e.deleted_at IS NULL LIMIT 1`);
  return row;
}

/* -------------------------------------------------------------------- WMS */

async function syncWms(ctx: DomainContext, tally: Tally): Promise<void> {
  const settings = await loadSettings(ctx.orgId);
  const links = await linkRows(ctx, ['wms_work_order']);
  const orders = await listWorkOrders(ctx, { ids: links.map((link) => link.target_id) });
  const orderById = new Map(orders.map((order) => [order.id, order]));
  tally.counts.workOrders = (await listWorkOrders(ctx, { limit: 500 })).length;
  tally.counts.linkedWorkOrders = orders.length;
  const closed = await closedMonths(db, ctx.orgId);

  // 1. Fresh copies on the links, the shortage flag and "the warehouse finished it".
  for (const link of links) {
    const order = orderById.get(link.target_id);
    if (!order) continue;
    const title = `${order.code}${order.note ? ` ${order.note}` : order.kitName ? ` ${order.kitName}` : ''}`.slice(0, 200);
    if (await refreshLink(ctx, link, { title, status: order.status, path: order.path, meta: { requestedQty: order.requestedQty, finishedQty: order.finishedQty } })) tally.updated += 1;
    const shortage = order.status === 'Shortage';
    if (shortage !== link.wms_shortage) {
      await inTx(async (tx) => {
        await tx.execute(sql`UPDATE pulse.jobs SET wms_shortage = ${shortage}, updated_at = now() WHERE id = ${link.job_id} AND org_id = ${ctx.orgId}`);
        await logActivity(tx, ctx, { verb: 'sync.updated', entityType: 'job', entityId: link.job_id, jobId: link.job_id, clientId: link.client_id, field: 'wmsShortage', before: link.wms_shortage, after: shortage });
        await recomputeJobs(tx, ctx, [link.job_id]);
      });
      tally.updated += 1;
    }
    if (order.status === 'Completed' && (link.job_status === 'active' || link.job_status === 'planned') && !(order.actualFinish && closed.has(monthStart(order.actualFinish)))) {
      try {
        await setJobStatus(ctx, link.job_id, 'completed', { completedDate: order.actualFinish });
        tally.updated += 1;
      } catch {
        tally.skipped += 1;
      }
    }
  }

  // 2. Kits built per day. A day a person already typed is adopted, never added a second time.
  const byZone = new Map<string, LinkRow[]>();
  for (const link of links) if (orderById.has(link.target_id)) byZone.set(link.timezone, [...(byZone.get(link.timezone) ?? []), link]);
  let buildDays = 0;
  for (const [timezone, zoneLinks] of byZone) {
    const builds = await workOrderBuildsByDay(ctx, [...new Set(zoneLinks.map((link) => link.target_id))], timezone);
    buildDays += builds.length;
    for (const build of builds) {
      // One work order feeds one job: the oldest link wins.
      const link = zoneLinks.find((item) => item.target_id === build.workOrderId);
      if (!link) continue;
      const ref = `wms:built:${build.workOrderId}:${build.workDate}`;
      const units = String(build.kits);
      if (closed.has(monthStart(build.workDate))) {
        if (!(await entryByRef(ctx, ref))) tally.skippedClosed += 1;
        continue;
      }
      try {
        const existing = await entryByRef(ctx, ref);
        if (existing) {
          if (!sameNumber(existing.units_good, units) && existing.source === 'wms' && !lockedFields(existing).includes('unitsGood')) {
            await updatePulledEntry(ctx, link, existing, { unitsGood: units });
            tally.updated += 1;
          }
          continue;
        }
        const [typed] = await rows<EntryRow>(
          db,
          sql`SELECT ${ENTRY_COLUMNS} FROM pulse.production_entries e
               WHERE e.org_id = ${ctx.orgId} AND e.job_id = ${link.job_id} AND e.work_date = ${build.workDate}::date AND e.shift = 'day'
                 AND e.source_ref IS NULL AND e.deleted_at IS NULL
               ORDER BY e.created_at LIMIT 1`,
        );
        if (typed) {
          await updatePulledEntry(ctx, link, typed, { sourceRef: ref, adoptedFrom: 'wms', unitsGood: Number(typed.units_good) === 0 ? units : undefined });
          tally.updated += 1;
          continue;
        }
        await saveProductionEntry(ctx, { jobId: link.job_id, workDate: build.workDate, shift: 'day', laborClassId: link.default_labor_class_id, unitsGood: units, hours: '0', hoursConfirmed: false, note: 'Built in the warehouse. Add people and hours.', source: 'wms', sourceRef: ref });
        tally.created += 1;
      } catch (error) {
        if (isClosedMonth(error)) tally.skippedClosed += 1;
        else tally.skipped += 1;
      }
    }
  }
  tally.counts.buildDays = buildDays;

  // 3. Parts used: the difference since the last pull, at the warehouse's cost for one part.
  if (settings.wmsSyncMaterials) {
    for (const link of links) {
      const order = orderById.get(link.target_id);
      if (!order || order.status === 'Cancelled' || link.job_status === 'cancelled') continue;
      try {
        const pulled = await pullWmsUsage(ctx, link.job_number);
        tally.created += pulled.added.length;
        tally.updated += pulled.updated + pulled.removed;
        tally.skippedClosed += pulled.skippedClosed;
      } catch (error) {
        if (isClosedMonth(error)) tally.skippedClosed += 1;
        else tally.skipped += 1;
      }
    }
  }

  // 4. Warehouse bills as "billed" memo rows per client, per bill and kind of work. Never profit.
  if (settings.wmsSyncBilling) {
    const lines = await listBilledRevenue(ctx);
    tally.counts.billLines = lines.length;
    if (lines.length > 0) {
      const clients = await rows<{ id: string; core_customer_id: string }>(db, sql`SELECT id, core_customer_id::text AS core_customer_id FROM pulse.clients WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND core_customer_id IS NOT NULL`);
      const clientByCustomer = new Map(clients.map((client) => [client.core_customer_id, client.id]));
      const existing = await rows<{ id: string; source_ref: string; amount_cents: string; approved: boolean; revenue_date: string }>(
        db,
        sql`SELECT id, source_ref, amount_cents::text AS amount_cents, approved, revenue_date::text AS revenue_date FROM pulse.revenue_entries
             WHERE org_id = ${ctx.orgId} AND source = 'wms' AND source_ref LIKE 'wms:bill:%' AND deleted_at IS NULL`,
      );
      const byRef = new Map(existing.map((row) => [row.source_ref, row]));
      const seen = new Set<string>();
      for (const line of lines) {
        seen.add(line.ref);
        const clientId = clientByCustomer.get(line.clientId);
        if (!clientId) {
          tally.skipped += 1;
          continue;
        }
        const have = byRef.get(line.ref);
        if (have && Number(have.amount_cents) === line.amountCents && have.approved === line.approved) continue;
        if (closed.has(monthStart(line.periodEnd))) {
          tally.skippedClosed += 1;
          continue;
        }
        try {
          await saveRevenue(ctx, {
            id: have?.id ?? null,
            clientId,
            revenueDate: line.periodEnd,
            kind: 'invoice',
            description: `Warehouse bill${line.billNumber ? ` ${line.billNumber}` : ''}: ${line.operation}`,
            amountCents: line.amountCents,
            invoiceNumber: line.billNumber,
            serviceLabel: line.operation,
            approved: line.approved,
            source: 'wms',
            sourceRef: line.ref,
          });
          if (have) tally.updated += 1;
          else tally.created += 1;
        } catch (error) {
          if (isClosedMonth(error)) tally.skippedClosed += 1;
          else tally.skipped += 1;
        }
      }
      // A bill the warehouse canceled or recalculated away is taken out again (open months only).
      for (const row of existing) {
        if (seen.has(row.source_ref) || closed.has(monthStart(row.revenue_date))) continue;
        try {
          await deleteRevenue(ctx, row.id);
          tally.updated += 1;
        } catch {
          tally.skipped += 1;
        }
      }
    }
  }

  // 5. The warehouse contract's work order rates set the price of each linked job.
  try {
    const priced = await applyWmsContractPrices(ctx, links.filter((link) => orderById.has(link.target_id)));
    tally.updated += priced.updated;
    tally.skipped += priced.skipped;
    tally.skippedClosed += priced.skippedClosed;
    tally.counts.contractJobs = priced.jobs;
    tally.counts.contractNotApplied = priced.notApplied;
  } catch (error) {
    tally.skipped += 1;
    logSoftFail(ctx.orgId, 'sync.contractPrices', error);
  }

  // 6. Extra services done in the warehouse become extra service entries, on the job or the client.
  try {
    const services = await pullWmsServices(ctx);
    if (services.read) {
      tally.created += services.created;
      tally.updated += services.updated + services.removed;
      tally.skipped += services.skipped;
      tally.skippedClosed += services.skippedClosed;
      tally.counts.vasRecords = services.records;
      tally.counts.vasInPulse = services.inPulse;
      tally.counts.vasNoPrice = services.noPrice;
      tally.counts.vasContractPriced = services.contractPriced;
      tally.counts.vasNoClient = services.noClient;
    }
  } catch (error) {
    tally.skipped += 1;
    logSoftFail(ctx.orgId, 'sync.wmsServices', error);
  }
}

/* -------------------------------------------------------------------- CRM */

async function syncCrm(ctx: DomainContext, tally: Tally): Promise<void> {
  const links = await linkRows(ctx, ['crm_deal', 'crm_account']);
  const [deals, accounts, won] = await Promise.all([
    getDeals(ctx, links.filter((link) => link.target_type === 'crm_deal').map((link) => link.target_id)),
    getAccounts(ctx, links.filter((link) => link.target_type === 'crm_account').map((link) => link.target_id)),
    listWonDeals(ctx, { limit: 500 }),
  ]);
  for (const link of links) {
    if (link.target_type === 'crm_deal') {
      const deal = deals.find((item) => item.id === link.target_id);
      if (!deal) continue;
      // The deal value rides on the link, so the job can say when CRM and the quote disagree.
      if (await refreshLink(ctx, link, { title: deal.name, status: deal.stage, path: deal.path, meta: { dealValueCents: deal.valueCents, currency: deal.currency, won: deal.won, closeDate: deal.closeDate } })) tally.updated += 1;
    } else {
      const account = accounts.find((item) => item.id === link.target_id);
      if (account && (await refreshLink(ctx, link, { title: account.name, status: account.health, path: account.path }))) tally.updated += 1;
    }
  }
  const linkedDeals = new Set(links.filter((link) => link.target_type === 'crm_deal').map((link) => link.target_id));
  tally.counts.wonDeals = won.length;
  tally.counts.wonDealsWithJob = won.filter((deal) => linkedDeals.has(deal.id)).length;
  tally.counts.wonDealsNoJob = won.filter((deal) => !linkedDeals.has(deal.id)).length;
  tally.counts.linkedDeals = linkedDeals.size;
}

/* --------------------------------------------------------------- Projects */

const PROJECT_HEALTH: Readonly<Record<string, string>> = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };
const PROJECT_STATUS: Readonly<Record<string, string>> = { planning: 'Planning', active: 'Active', on_hold: 'On hold', completed: 'Completed', archived: 'Archived' };

async function syncProjects(ctx: DomainContext, tally: Tally): Promise<void> {
  const settings = await loadSettings(ctx.orgId);
  const links = await linkRows(ctx, ['pm_project']);
  const projects = await getProjects(ctx, links.map((link) => link.target_id));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  for (const link of links) {
    const project = projectById.get(link.target_id);
    if (!project) continue;
    const status = project.status === 'active' ? (PROJECT_HEALTH[project.health] ?? 'Active') : (PROJECT_STATUS[project.status] ?? project.status);
    if (await refreshLink(ctx, link, { title: project.name, status, path: project.path, meta: { key: project.key, percentDone: project.percentDone, dueDate: project.dueDate } })) tally.updated += 1;
  }
  tally.counts.linkedProjects = projectById.size;

  // Logged time as labor hours. A project's time feeds one job only: the oldest link that asks for it.
  const feeds = new Map<string, LinkRow>();
  for (const link of links) {
    if (!link.imports_time || !projectById.has(link.target_id) || link.job_status === 'cancelled') continue;
    if (feeds.has(link.target_id)) tally.skipped += 1;
    else feeds.set(link.target_id, link);
  }
  tally.counts.projectsWithTime = feeds.size;
  if (!settings.projectsTimeImport || feeds.size === 0) return;
  const closed = await closedMonths(db, ctx.orgId);
  const byZone = new Map<string, LinkRow[]>();
  for (const link of feeds.values()) byZone.set(link.timezone, [...(byZone.get(link.timezone) ?? []), link]);
  let days = 0;
  const seenRefs: string[] = [];
  for (const [timezone, zoneLinks] of byZone) {
    // Strict read: rows are taken away below when their time is gone, so a failed read must not look like "no time".
    const time = await projectTimeByDay(ctx, zoneLinks.map((link) => link.target_id), timezone, { throwOnError: true });
    days += time.length;
    seenRefs.push(...time.map((day) => `pm:${day.projectId}:${day.workDate}`));
    for (const day of time) {
      const link = zoneLinks.find((item) => item.target_id === day.projectId);
      if (!link) continue;
      const ref = `pm:${day.projectId}:${day.workDate}`;
      // Hours are time, not money: minutes over 60, kept to two places like every hours column.
      const hours = (Math.round((day.minutes / 60) * 100) / 100).toFixed(2);
      const headcount = String(Math.max(day.people, 1));
      const existing = await entryByRef(ctx, ref);
      if (closed.has(monthStart(day.workDate))) {
        if (!existing || !sameNumber(existing.hours, hours)) tally.skippedClosed += 1;
        continue;
      }
      try {
        if (existing) {
          const locked = lockedFields(existing);
          const newHours = !sameNumber(existing.hours, hours) && !locked.includes('hours') ? hours : undefined;
          const newPeople = !sameNumber(existing.headcount, headcount) && !locked.includes('headcount') ? headcount : undefined;
          if (existing.source === 'projects' && (newHours || newPeople)) {
            await updatePulledEntry(ctx, link, existing, { hours: newHours, headcount: newPeople });
            tally.updated += 1;
          }
          continue;
        }
        // Its own shift keeps project time apart from the units a person types for the same day.
        await saveProductionEntry(ctx, { jobId: link.job_id, workDate: day.workDate, shift: 'projects', laborClassId: link.default_labor_class_id, unitsGood: '0', headcount, hours, hoursConfirmed: true, note: 'Time logged in KitStak Projects.', source: 'projects', sourceRef: ref });
        tally.created += 1;
      } catch (error) {
        if (isClosedMonth(error)) tally.skippedClosed += 1;
        else tally.skipped += 1;
      }
    }
  }
  tally.counts.timeDays = days;
  await removeGoneProjectTime(ctx, [...feeds.keys()], new Set(seenRefs), closed, tally);
}

/**
 * A day whose time was deleted in Projects is taken out of Pulse on the next sync, so labor is
 * never counted for time nobody logged. Only rows the sync wrote (`source = 'projects'`) and only
 * in open months; a row a person changed the hours on is theirs and stays.
 */
async function removeGoneProjectTime(ctx: DomainContext, projectIds: readonly string[], seen: ReadonlySet<string>, closed: ReadonlySet<string>, tally: Tally): Promise<void> {
  if (projectIds.length === 0) return;
  const pulled = await rows<EntryRow>(
    db,
    sql`SELECT ${ENTRY_COLUMNS} FROM pulse.production_entries e
         WHERE e.org_id = ${ctx.orgId} AND e.source = 'projects' AND e.deleted_at IS NULL
           AND split_part(e.source_ref, ':', 1) = 'pm' AND split_part(e.source_ref, ':', 2) IN (${sql.join(projectIds.map((id) => sql`${id}`), sql`, `)})`,
  );
  const gone = pulled.filter((row) => row.source_ref && !seen.has(row.source_ref) && !lockedFields(row).includes('hours'));
  const open = gone.filter((row) => !closed.has(monthStart(row.work_date)));
  tally.skippedClosed += gone.length - open.length;
  if (open.length === 0) return;
  try {
    await deleteProductionEntries(ctx, open.map((row) => row.id));
    tally.updated += open.length;
  } catch (error) {
    if (isClosedMonth(error)) tally.skippedClosed += open.length;
    else tally.skipped += open.length;
  }
}

/* ------------------------------------------------------------ run and state */

const WORK: Readonly<Record<SiblingApp, (ctx: DomainContext, tally: Tally) => Promise<void>>> = { crm: syncCrm, wms: syncWms, projects: syncProjects };

const APP_WORDS: Readonly<Record<SiblingApp, string>> = { crm: 'CRM', wms: 'the warehouse', projects: 'Projects' };

function resultMessage(source: SiblingApp, tally: Tally): string {
  const parts: string[] = [];
  if (tally.created > 0) parts.push(`${tally.created} added`);
  if (tally.updated > 0) parts.push(`${tally.updated} updated`);
  if (tally.skippedClosed > 0) parts.push(`${tally.skippedClosed} left out because the month is closed`);
  if (tally.skipped > 0) parts.push(`${tally.skipped} skipped`);
  return parts.length === 0 ? `Everything from ${APP_WORDS[source]} is already up to date.` : `Synced with ${APP_WORDS[source]}: ${parts.join(', ')}.`;
}

/**
 * One sync of one app. Takes the lease, records the run and never throws: a failure is stored
 * on the run and on `sync_state`, and comes back as `status: 'failed'` with a plain sentence.
 */
async function runOne(ctx: DomainContext, source: SiblingApp, trigger: Trigger): Promise<SyncResultDTO> {
  const none = { source, created: 0, updated: 0, skipped: 0, skippedClosed: 0 };
  let leased = false;
  try {
    const available = await integrationAvailability(ctx);
    if (!available[source]) return { ...none, status: 'skipped', message: `${APP_WORDS[source][0]?.toUpperCase()}${APP_WORDS[source].slice(1)} is not connected for this workspace.` };
    const [lease] = await rows<{ org_id: string }>(
      db,
      sql`INSERT INTO pulse.sync_state (org_id, source, locked_until) VALUES (${ctx.orgId}, ${source}, now() + make_interval(mins => ${LEASE_MINUTES}))
          ON CONFLICT (org_id, source) DO UPDATE SET locked_until = EXCLUDED.locked_until, updated_at = now()
            WHERE pulse.sync_state.locked_until IS NULL OR pulse.sync_state.locked_until < now()
          RETURNING org_id`,
    );
    if (!lease) return { ...none, status: 'skipped', message: 'A sync is already running. Try again in a minute.' };
    leased = true;
  } catch {
    return { ...none, status: 'skipped', message: 'Sync could not start. Try again in a minute.' };
  }
  const [run] = await rows<{ id: string }>(db, sql`INSERT INTO pulse.sync_runs (org_id, source, status, trigger) VALUES (${ctx.orgId}, ${source}, 'running', ${trigger}) RETURNING id`);
  const tally = newTally();
  let failure: string | null = null;
  try {
    await WORK[source](asIntegration(ctx), tally);
  } catch (error) {
    failure = isDomainError(error) ? error.message : 'Something went wrong while reading the other app. Nothing was half written. Try again.';
    console.error('[pulse] sync failed', { orgId: ctx.orgId, source, error });
  }
  const status = failure ? 'failed' : 'ok';
  try {
    if (run) {
      await db.execute(
        sql`UPDATE pulse.sync_runs SET finished_at = now(), status = ${status}, created = ${tally.created}, updated = ${tally.updated}, skipped = ${tally.skipped},
                   skipped_closed = ${tally.skippedClosed}, error = ${failure}, updated_at = now() WHERE id = ${run.id}`,
      );
    }
    await db.execute(
      sql`UPDATE pulse.sync_state
             SET locked_until = NULL, last_run_at = now(), last_status = ${status}, last_error = ${failure},
                 last_ok_at = CASE WHEN ${status} = 'ok' THEN now() ELSE last_ok_at END,
                 counts = CASE WHEN ${status} = 'ok' THEN ${JSON.stringify(tally.counts)}::jsonb ELSE counts END, updated_at = now()
           WHERE org_id = ${ctx.orgId} AND source = ${source}`,
    );
  } catch (error) {
    if (leased) console.error('[pulse] sync state not saved', { orgId: ctx.orgId, source, error });
  }
  return { source, status, created: tally.created, updated: tally.updated, skipped: tally.skipped, skippedClosed: tally.skippedClosed, message: failure ?? resultMessage(source, tally) };
}

/** "Sync now": a manager pulls one app, or all the connected ones. */
export async function runSync(ctx: DomainContext, source: SiblingApp | 'all'): Promise<SyncResultDTO[]> {
  await requirePulse(ctx, 'job:manage');
  const results: SyncResultDTO[] = [];
  for (const app of source === 'all' ? SOURCES : [source]) results.push(await runOne(ctx, app, 'manual'));
  return results;
}

/**
 * Background refresh: pulls each connected app whose last sync is older than ten minutes, and
 * first answers any change notes the sibling apps left in `bridge_events`. Never throws. Call it
 * from `after()` on a page load, and from the cron tick.
 */
export async function syncIfStale(ctx: DomainContext, trigger: 'page' | 'cron' = 'page'): Promise<void> {
  try {
    const claimed = await claimBridgeEvents(ctx);
    const state = await rows<{ source: SiblingApp; stale: boolean }>(
      db,
      sql`SELECT source, (last_run_at IS NULL OR last_run_at < now() - make_interval(mins => ${SYNC_STALE_MINUTES})) AS stale FROM pulse.sync_state WHERE org_id = ${ctx.orgId}`,
    );
    const fresh = new Set(state.filter((row) => !row.stale).map((row) => row.source));
    const available = await integrationAvailability(ctx);
    // A note nobody can act on (an app that is not connected, a kind Pulse does not know) is done.
    const nothingToDo = [...claimed.unknown, ...SOURCES.filter((source) => !available[source]).flatMap((source) => claimed.bySource.get(source) ?? [])];
    await finishBridgeEvents(ctx, nothingToDo, { outcome: 'done' });
    for (const source of SOURCES) {
      if (!available[source]) continue;
      const events = claimed.bySource.get(source) ?? [];
      if (events.length > 0) {
        const result = await runOne(ctx, source, 'event');
        if (result.status === 'ok') await finishBridgeEvents(ctx, events, { outcome: 'done' });
        else if (result.status === 'failed') await finishBridgeEvents(ctx, events, { outcome: 'failed', error: result.message });
        else await finishBridgeEvents(ctx, events, { outcome: 'busy' });
      } else if (!fresh.has(source)) await runOne(ctx, source, trigger);
    }
  } catch (error) {
    console.error('[pulse] background sync skipped', { orgId: ctx.orgId, error: error instanceof Error ? error.message : String(error) });
  }
}

const EVENT_SOURCE: Readonly<Record<string, SiblingApp>> = { wms_work_order_changed: 'wms', crm_deal_stage_changed: 'crm', pm_time_logged: 'projects' };

/** A note is tried this many times, then parked with its last error. */
export const BRIDGE_EVENT_MAX_ATTEMPTS = 5;
/** A claim older than this is treated as dropped (the request died) and can be taken again. */
const BRIDGE_CLAIM_MINUTES = 5;

interface ClaimedEvents {
  readonly bySource: Map<SiblingApp, string[]>;
  readonly unknown: string[];
}

/**
 * Takes the waiting change notes of this workspace (skipping ones another request holds): sets
 * `claimed_at` as a five minute lease and bumps `attempts`. `processed_at` is only set once the
 * note was handled (`finishBridgeEvents`). A claim older than five minutes that never finished
 * can be taken again. A note that already used its five tries is parked: `processed_at` is set
 * and `last_error` says why, so it stops blocking newer notes for the same record.
 */
export async function claimBridgeEvents(ctx: DomainContext): Promise<ClaimedEvents> {
  const out: ClaimedEvents = { bySource: new Map(), unknown: [] };
  try {
    await db.execute(
      sql`UPDATE pulse.bridge_events SET processed_at = now(), last_error = COALESCE(last_error, ${`Gave up after ${BRIDGE_EVENT_MAX_ATTEMPTS} tries.`}), updated_at = now()
           WHERE org_id = ${ctx.orgId} AND processed_at IS NULL AND attempts >= ${BRIDGE_EVENT_MAX_ATTEMPTS}
             AND (claimed_at IS NULL OR claimed_at < now() - make_interval(mins => ${BRIDGE_CLAIM_MINUTES}))`,
    );
    const claimed = await rows<{ id: string; kind: string }>(
      db,
      sql`UPDATE pulse.bridge_events SET claimed_at = now(), attempts = attempts + 1, updated_at = now()
           WHERE id IN (SELECT id FROM pulse.bridge_events
                         WHERE org_id = ${ctx.orgId} AND processed_at IS NULL AND attempts < ${BRIDGE_EVENT_MAX_ATTEMPTS}
                           AND (claimed_at IS NULL OR claimed_at < now() - make_interval(mins => ${BRIDGE_CLAIM_MINUTES}))
                         ORDER BY created_at LIMIT 200 FOR UPDATE SKIP LOCKED)
       RETURNING id::text AS id, kind`,
    );
    for (const event of claimed) {
      const source = EVENT_SOURCE[event.kind];
      if (source) out.bySource.set(source, [...(out.bySource.get(source) ?? []), event.id]);
      else out.unknown.push(event.id);
    }
  } catch (error) {
    console.error('[pulse] change notes not claimed', { orgId: ctx.orgId, message: error instanceof Error ? error.message : String(error) });
  }
  return out;
}

/**
 * Settles claimed notes. `done`: handled, `processed_at` set. `failed`: keeps the lease so the
 * next try waits five minutes, stores the error, and parks the note on its last try. `busy`:
 * another sync held the app, so the lease and the try are given back and the next page load
 * takes the note again.
 */
export async function finishBridgeEvents(ctx: DomainContext, ids: readonly string[], result: { outcome: 'done' | 'busy' } | { outcome: 'failed'; error: string }): Promise<void> {
  if (ids.length === 0) return;
  const list = sql`ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[]`;
  try {
    if (result.outcome === 'done') {
      await db.execute(sql`UPDATE pulse.bridge_events SET processed_at = now(), last_error = NULL, updated_at = now() WHERE org_id = ${ctx.orgId} AND id = ANY(${list}) AND processed_at IS NULL`);
    } else if (result.outcome === 'busy') {
      await db.execute(sql`UPDATE pulse.bridge_events SET claimed_at = NULL, attempts = GREATEST(attempts - 1, 0), updated_at = now() WHERE org_id = ${ctx.orgId} AND id = ANY(${list}) AND processed_at IS NULL`);
    } else if (result.outcome === 'failed') {
      await db.execute(
        sql`UPDATE pulse.bridge_events SET last_error = ${result.error.slice(0, 500)},
                   processed_at = CASE WHEN attempts >= ${BRIDGE_EVENT_MAX_ATTEMPTS} THEN now() ELSE NULL END, updated_at = now()
             WHERE org_id = ${ctx.orgId} AND id = ANY(${list}) AND processed_at IS NULL`,
      );
    }
  } catch (error) {
    console.error('[pulse] change notes not settled', { orgId: ctx.orgId, outcome: result.outcome, message: error instanceof Error ? error.message : String(error) });
  }
}

function toRun(row: Record<string, unknown>): SyncRunDTO {
  return {
    id: String(row.id),
    source: row.source as SiblingApp,
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    status: String(row.status),
    created: Number(row.created) || 0,
    updated: Number(row.updated) || 0,
    skipped: Number(row.skipped) || 0,
    skippedClosed: Number(row.skipped_closed) || 0,
    error: row.error ? String(row.error) : null,
    trigger: String(row.trigger),
  };
}

/** The Connected apps page: each sibling app's state, when it last synced and what it saw. */
export async function getConnectedApps(ctx: DomainContext): Promise<ConnectedAppsDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const [modules, available, settings] = await Promise.all([orgModuleFlags(ctx.orgId), integrationAvailability(ctx), loadSettings(ctx.orgId)]);
  const [state, runs, linked] = await Promise.all([
    rows<{ source: SiblingApp; last_ok_at: string | null; last_run_at: string | null; last_status: string | null; last_error: string | null; counts: Record<string, number> | null; running: boolean }>(
      db,
      sql`SELECT source, to_char(last_ok_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_ok_at, to_char(last_run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_run_at,
                 last_status, last_error, counts, (locked_until IS NOT NULL AND locked_until > now()) AS running
            FROM pulse.sync_state WHERE org_id = ${ctx.orgId}`,
    ),
    rows<Record<string, unknown>>(
      db,
      sql`SELECT DISTINCT ON (source) id, source, to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS started_at,
                 to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS finished_at, status, created, updated, skipped, skipped_closed, error, trigger
            FROM pulse.sync_runs WHERE org_id = ${ctx.orgId} AND status <> 'running' ORDER BY source, started_at DESC`,
    ),
    rows<{ app: SiblingApp; n: number }>(
      db,
      sql`SELECT CASE WHEN l.target_type LIKE 'crm_%' THEN 'crm' WHEN l.target_type LIKE 'wms_%' THEN 'wms' ELSE 'projects' END AS app, count(DISTINCT l.job_id)::int AS n
            FROM pulse.job_links l JOIN pulse.jobs j ON j.id = l.job_id AND j.deleted_at IS NULL WHERE l.org_id = ${ctx.orgId} GROUP BY 1`,
    ),
  ]);
  const urls = appUrls();
  const apps: AppConnectionDTO[] = SOURCES.map((app) => {
    const row = state.find((item) => item.source === app);
    const run = runs.find((item) => item.source === app);
    return {
      app,
      state: available[app] ? 'connected' : modules[app] ? 'not_set_up' : 'not_on_plan',
      url: urls[app],
      lastSyncedAt: row?.last_ok_at ?? null,
      lastStatus: row?.last_status ?? null,
      lastError: row?.last_status === 'failed' ? (row.last_error ?? null) : null,
      running: Boolean(row?.running),
      counts: row?.counts ?? {},
      linkedJobs: linked.find((item) => item.app === app)?.n ?? 0,
      lastRun: run ? toRun(run) : null,
    };
  });
  return {
    apps,
    canManage: access.role === 'owner' || access.role === 'admin' || access.role === 'manager',
    switches: { wmsSyncMaterials: settings.wmsSyncMaterials, wmsSyncBilling: settings.wmsSyncBilling, crmSuggestJobs: settings.crmSuggestJobs, projectsTimeImport: settings.projectsTimeImport },
  };
}

/** Every link between a job and a sibling record, newest first. */
export async function listLinkedJobs(ctx: DomainContext, options: { limit?: number } = {}): Promise<LinkedJobDTO[]> {
  await requirePulse(ctx, 'pulse:read');
  const found = await rows<{ link_id: string; job_id: string; number: string; name: string; target_type: LinkTargetType; target_id: string; imports_time: boolean; cached_title: string | null; cached_status: string | null; cached_url: string | null }>(
    db,
    sql`SELECT l.id AS link_id, j.id AS job_id, j.number, j.name, l.target_type, l.target_id, l.imports_time, l.cached_title, l.cached_status, l.cached_url
          FROM pulse.job_links l JOIN pulse.jobs j ON j.id = l.job_id AND j.deleted_at IS NULL
         WHERE l.org_id = ${ctx.orgId}
         ORDER BY l.created_at DESC, l.id
         LIMIT ${Math.min(options.limit ?? 200, 500)}`,
  );
  return found.map((row) => ({
    linkId: row.link_id,
    jobId: row.job_id,
    jobNumber: row.number,
    jobName: row.name,
    targetType: row.target_type,
    targetId: row.target_id,
    importsTime: row.imports_time,
    title: row.cached_title,
    status: row.cached_status,
    path: row.cached_url,
  }));
}

/** Turns "count this project's time as labor hours" on or off for one link. */
export async function setLinkImportsTime(ctx: DomainContext, linkId: string, importsTime: boolean): Promise<void> {
  await requirePulse(ctx, 'job:manage');
  await inTx(async (tx) => {
    const [row] = await rows<{ id: string; job_id: string; imports_time: boolean }>(
      tx,
      sql`UPDATE pulse.job_links SET imports_time = ${importsTime}, updated_at = now() WHERE id = ${linkId} AND org_id = ${ctx.orgId} AND target_type = 'pm_project' RETURNING id, job_id, NOT imports_time AS imports_time`,
    );
    if (!row) return;
    await logActivity(tx, ctx, { verb: 'link.changed', entityType: 'link', entityId: row.id, jobId: row.job_id, field: 'importsTime', before: !importsTime, after: importsTime });
  });
}
