/**
 * Sample data and the danger zone.
 *
 * `loadSampleData` builds a small made up shop through the same domain functions people use, so
 * every number on screen is real math: three labor classes with rates, two job types, three
 * clients, five jobs in different states (healthy, heading for a loss, fixed price, finished,
 * not started), two weeks of logged work, time not on a job, paid hours, materials, extra
 * services, costs, invoices, target pace and goals. Every row is marked as sample
 * (`is_sample`), so `clearSampleData` can take it all out again and leave real work untouched.
 *
 * `purgeAllData` is the owner only "delete all Pulse data" switch.
 */
import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { settings } from '@/server/db/schema';
import { conflict, invalid } from '@/server/errors';
import { addDays, isWorkDay } from '@/lib/profit/calendar';
import { inTx, iso, rows, todayInZone, uuidArray, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { logActivity } from './activity';
import { evaluateAlerts } from './alerts';
import { createClient, createJobType, createVasService, listSites } from './catalog';
import { saveCost, saveMaterialUsage, saveRevenue, saveVasEntry } from './entries';
import { createJob, setJobStatus } from './jobs';
import { createLaborClass, createLaborRate } from './labor';
import { savePlan } from './plans';
import { saveProductionBulk, type ProductionInput } from './production';
import { recalcOrg } from './recalc';
import { loadSettings } from './settings';
import { saveStandard, saveTarget } from './standards';
import { saveIndirectEntry, savePaidHours } from './time';

export interface SampleStateDTO {
  readonly loaded: boolean;
  readonly loadedAt: string | null;
  /** Live rows that carry the sample mark, by kind. */
  readonly jobs: number;
  readonly clients: number;
  readonly entries: number;
}

export const getSampleState = scoped(async function getSampleState(ctx: DomainContext): Promise<SampleStateDTO> {
  await requirePulse(ctx, 'pulse:read');
  const row = await loadSettings(ctx.orgId);
  const [counts] = await rows<{ jobs: number; clients: number; entries: number }>(
    db,
    sql`SELECT (SELECT count(*)::int FROM pulse.jobs WHERE org_id = ${ctx.orgId} AND is_sample AND deleted_at IS NULL) AS jobs,
               (SELECT count(*)::int FROM pulse.clients WHERE org_id = ${ctx.orgId} AND is_sample AND deleted_at IS NULL) AS clients,
               (SELECT count(*)::int FROM pulse.production_entries WHERE org_id = ${ctx.orgId} AND is_sample AND deleted_at IS NULL) AS entries`,
  );
  const jobs = counts?.jobs ?? 0;
  return { loaded: row.sampleLoadedAt !== null || jobs > 0, loadedAt: iso(row.sampleLoadedAt), jobs, clients: counts?.clients ?? 0, entries: counts?.entries ?? 0 };
});

/** The last `count` work days that end yesterday, oldest first. */
function recentWorkDays(today: string, count: number): string[] {
  const days: string[] = [];
  for (let cursor = addDays(today, -1); days.length < count; cursor = addDays(cursor, -1)) if (isWorkDay(cursor)) days.unshift(cursor);
  return days;
}

async function idsOf(executor: Executor, orgId: string, table: 'labor_classes' | 'job_types' | 'vas_services' | 'items'): Promise<Set<string>> {
  return new Set((await rows<{ id: string }>(executor, sql`SELECT id FROM pulse.${sql.raw(table)} WHERE org_id = ${orgId}`)).map((row) => row.id));
}

async function buildSampleShop(ctx: DomainContext): Promise<{ jobs: number; entries: number }> {
  const [site] = await listSites(ctx);
  if (!site) throw invalid('This workspace has no site yet. Add one in Settings first.');
  const today = site.today;
  const days = recentWorkDays(today, 10);
  const first = days[0] as string;
  const yearStart = `${first.slice(0, 4)}-01-01`;
  const isSample = true;

  // Labor: a packer costs $16.00 an hour in wages, 9% taxes, 12% benefits and $2.40 overhead, so one hour really costs $21.76.
  const packer = await createLaborClass(ctx, { name: 'Packer (sample)', color: 'blue' });
  const lead = await createLaborClass(ctx, { name: 'Line lead (sample)', color: 'purple' });
  const temp = await createLaborClass(ctx, { name: 'Temp packer (sample)', kind: 'temp_agency', color: 'orange' });
  await createLaborRate(ctx, { laborClassId: packer.id, effectiveFrom: yearStart, wageCents: 1600, payrollTaxBp: 900, benefitsBp: 1200, otherBurdenBp: 0, overheadPerHourCents: 240, overtimeMultiplier: '1.50', isSample });
  await createLaborRate(ctx, { laborClassId: lead.id, effectiveFrom: yearStart, wageCents: 2200, payrollTaxBp: 900, benefitsBp: 1200, otherBurdenBp: 0, overheadPerHourCents: 240, overtimeMultiplier: '1.50', isSample });
  await createLaborRate(ctx, { laborClassId: temp.id, effectiveFrom: yearStart, wageCents: 2150, payrollTaxBp: 0, benefitsBp: 0, otherBurdenBp: 0, overheadPerHourCents: 240, overtimeMultiplier: '1.50', isSample });

  const kitting = await createJobType(ctx, { name: 'Kitting (sample)', unitLabel: 'kits', defaultLaborClassId: packer.id, targetMarginBp: 3000, color: 'blue', icon: 'package', position: 90 });
  const rework = await createJobType(ctx, { name: 'Rework (sample)', unitLabel: 'units', defaultLaborClassId: packer.id, targetMarginBp: 2500, color: 'orange', icon: 'wrench', position: 91 });
  await saveStandard(ctx, { jobTypeId: kitting.id, unitsPerLaborHour: '42.000', effectiveFrom: yearStart, basis: 'typed', note: 'Starting target for kit builds', isSample });
  await saveStandard(ctx, { jobTypeId: rework.id, unitsPerLaborHour: '60.000', effectiveFrom: yearStart, basis: 'typed', isSample });

  const brightside = await createClient(ctx, { name: 'Brightside Snacks (sample)', contactName: 'Dana Ruiz', contactEmail: 'dana@brightside.example', partsOwner: 'client', targetMarginBp: 3000, color: 'green', isSample });
  const harbor = await createClient(ctx, { name: 'Harbor Outfitters (sample)', contactName: 'Sam Okafor', contactEmail: 'sam@harbor.example', partsOwner: 'us', color: 'teal', isSample });
  const northpeak = await createClient(ctx, { name: 'Northpeak Coffee (sample)', contactName: 'Lee Tran', contactEmail: 'lee@northpeak.example', partsOwner: 'client', color: 'brown', isSample });
  const labeling = await createVasService(ctx, { name: 'Labeling (sample)', unitLabel: 'labels', billing: 'per_unit', defaultPrice: '0.1200', defaultCostPerUnit: '0.0150', standardUph: '400.000', defaultLaborClassId: packer.id, color: 'pink' });

  // 1. A healthy per unit job, about half done.
  const gift = await createJob(ctx, {
    name: 'Holiday gift kits (sample)',
    clientId: brightside.id,
    jobTypeId: kitting.id,
    status: 'active',
    plannedUnits: '30000',
    unitPrice: '1.1000',
    materialCostPerUnit: '0.0600',
    defaultLaborClassId: packer.id,
    usualCrew: [
      { laborClassId: packer.id, headcount: 8 },
      { laborClassId: lead.id, headcount: 1 },
    ],
    startDate: first,
    dueDate: addDays(today, 12),
    poNumber: 'PO-88214',
    isSample,
    source: 'sample',
    quote: { units: '30000', revenueCents: 3_300_000, laborHours: '715', laborCents: 1_560_000, setupHours: '8', setupCents: 17_400, materialCents: 180_000, otherCents: 60_000, origin: 'sample' },
  });
  // 2. A crew that runs well under the target pace: this one heads for a loss.
  const sampler = await createJob(ctx, {
    name: 'Trail sampler boxes (sample)',
    clientId: harbor.id,
    jobTypeId: kitting.id,
    status: 'active',
    plannedUnits: '12000',
    unitPrice: '1.2500',
    materialCostPerUnit: '0.3800',
    defaultLaborClassId: packer.id,
    usualCrew: [{ laborClassId: packer.id, headcount: 6 }],
    startDate: days[3] as string,
    dueDate: addDays(today, 5),
    isSample,
    source: 'sample',
    quote: { units: '12000', revenueCents: 1_500_000, laborHours: '286', laborCents: 622_000, materialCents: 456_000, otherCents: 40_000, origin: 'sample' },
  });
  // 3. A fixed price rework job that earns by progress.
  const relabel = await createJob(ctx, {
    name: 'Relabel 8,000 pouches (sample)',
    clientId: northpeak.id,
    jobTypeId: rework.id,
    status: 'active',
    pricingModel: 'fixed',
    fixedPriceCents: 640_000,
    plannedUnits: '8000',
    materialMethod: 'actual',
    partsOwner: 'us',
    defaultLaborClassId: temp.id,
    usualCrew: [{ laborClassId: temp.id, headcount: 4 }],
    startDate: days[5] as string,
    dueDate: addDays(today, 8),
    isSample,
    source: 'sample',
    quote: { units: '8000', revenueCents: 640_000, laborHours: '134', laborCents: 320_000, materialCents: 64_000, otherCents: 0, origin: 'sample' },
  });
  // 4. A finished job.
  const display = await createJob(ctx, {
    name: 'Spring display packs (sample)',
    clientId: brightside.id,
    jobTypeId: kitting.id,
    status: 'active',
    plannedUnits: '4000',
    unitPrice: '1.3000',
    materialCostPerUnit: '0.0500',
    defaultLaborClassId: packer.id,
    startDate: first,
    dueDate: days[4] as string,
    isSample,
    source: 'sample',
    quote: { units: '4000', revenueCents: 520_000, laborHours: '96', laborCents: 209_000, materialCents: 20_000, otherCents: 15_000, origin: 'sample' },
  });
  // 5. Work that has not started yet.
  await createJob(ctx, {
    name: 'Summer cooler kits (sample)',
    clientId: harbor.id,
    jobTypeId: kitting.id,
    status: 'planned',
    plannedUnits: '9000',
    unitPrice: '2.1000',
    materialCostPerUnit: '0.7000',
    startDate: addDays(today, 6),
    dueDate: addDays(today, 30),
    isSample,
    source: 'sample',
    quote: { units: '9000', revenueCents: 1_890_000, laborHours: '225', laborCents: 490_000, materialCents: 630_000, otherCents: 50_000, origin: 'sample' },
  });
  await savePlan(ctx, gift.id, 'budget', { units: '30000', revenueCents: 3_300_000, laborHours: '740', laborCents: 1_615_000, setupHours: '8', setupCents: 17_400, materialCents: 180_000, otherCents: 60_000, origin: 'copied_from_quote' });

  const entries: ProductionInput[] = [];
  days.forEach((date, index) => {
    const overtime = index === 3 || index === 7 ? '6' : '0';
    entries.push({ jobId: gift.id, workDate: date, laborClassId: packer.id, unitsGood: String(1560 + ((index * 37) % 90)), unitsScrap: String(8 + (index % 5)), headcount: '8', hours: index === 0 ? '36' : '32', setupHours: index === 0 ? '4' : '0', overtimeHours: overtime, isSample, source: 'sample' });
    entries.push({ jobId: gift.id, workDate: date, laborClassId: lead.id, headcount: '1', hours: '4', isSample, source: 'sample' });
    if (index >= 3) entries.push({ jobId: sampler.id, workDate: date, laborClassId: packer.id, unitsGood: String(1180 + ((index * 53) % 140)), unitsScrap: String(22 + (index % 7)), headcount: '6', hours: '48', isSample, source: 'sample' });
    if (index >= 5) entries.push({ jobId: relabel.id, workDate: date, laborClassId: temp.id, unitsGood: String(880 + ((index * 29) % 70)), headcount: '4', hours: '16', isSample, source: 'sample' });
    if (index <= 4) entries.push({ jobId: display.id, workDate: date, laborClassId: packer.id, unitsGood: '800', unitsScrap: '5', headcount: '3', hours: '18', isSample, source: 'sample' });
  });
  await saveProductionBulk(ctx, entries);

  for (const [index, date] of days.entries()) {
    await saveIndirectEntry(ctx, { workDate: date, laborClassId: packer.id, reason: index % 5 === 0 ? 'meeting' : 'cleanup', headcount: '10', hours: index % 5 === 0 ? '5' : '2.5', isSample });
    if (index >= 5) await savePaidHours(ctx, { workDate: date, paidHours: '112', isSample });
  }
  for (const date of days.slice(5)) {
    await saveMaterialUsage(ctx, { jobId: relabel.id, usageDate: date, itemSku: 'SAMPLE-LBL-4X6', itemName: 'Pouch label 4 x 6 (sample)', quantityUsed: '900', quantityScrapped: '18', quantityPlanned: '1650', unitCost: '0.0800', uom: 'each', isSample });
  }
  await saveVasEntry(ctx, { vasServiceId: labeling.id, jobId: gift.id, workDate: days[6] as string, quantity: '3000', laborClassId: packer.id, headcount: '1', hours: '8', isSample });
  await saveVasEntry(ctx, { vasServiceId: labeling.id, jobId: gift.id, workDate: days[8] as string, quantity: '3200', laborClassId: packer.id, headcount: '1', hours: '8', isSample });

  await saveCost(ctx, { jobId: gift.id, costDate: days[2] as string, category: 'freight', amountCents: 28_500, vendor: 'Great Lakes Freight', reference: 'GLF-20418', isSample });
  await saveCost(ctx, { jobId: sampler.id, costDate: days[4] as string, category: 'packaging', amountCents: 19_000, vendor: 'Boxline Supply', isSample });
  await saveCost(ctx, { jobId: display.id, costDate: days[1] as string, category: 'freight', amountCents: 14_000, vendor: 'Great Lakes Freight', isSample });
  await saveCost(ctx, { costDate: first, category: 'rent', amountCents: 420_000, vendor: 'Lakeshore Industrial Park', note: 'Half month of rent', isSample });
  await saveCost(ctx, { costDate: first, category: 'utilities', amountCents: 61_000, isSample });

  await setJobStatus(ctx, display.id, 'completed', { completedDate: days[4] as string });
  await saveRevenue(ctx, { jobId: display.id, revenueDate: days[5] as string, kind: 'invoice', description: 'Spring display packs, 4,000 units', quantity: '4000', unitPrice: '1.3000', invoiceNumber: 'SAMPLE-INV-1042', isSample });
  await saveRevenue(ctx, { jobId: gift.id, revenueDate: days[4] as string, kind: 'invoice', description: 'Holiday gift kits, first 7,900 units', amountCents: 869_000, invoiceNumber: 'SAMPLE-INV-1043', isSample });
  await saveRevenue(ctx, { jobId: gift.id, revenueDate: days[6] as string, kind: 'fee', description: 'Rush pallet build', amountCents: 18_000, isSample });
  return { jobs: 5, entries: entries.length };
}

/** Loads the made up shop. Refuses when sample data is already there. */
export const loadSampleData = scoped(async function loadSampleData(ctx: DomainContext): Promise<SampleStateDTO> {
  await requirePulse(ctx, 'sample:manage');
  const state = await getSampleState(ctx);
  if (state.loaded) throw conflict('Sample data is already loaded. Remove it first if you want a fresh copy.');
  const before = {
    labor_classes: await idsOf(db, ctx.orgId, 'labor_classes'),
    job_types: await idsOf(db, ctx.orgId, 'job_types'),
    vas_services: await idsOf(db, ctx.orgId, 'vas_services'),
    items: await idsOf(db, ctx.orgId, 'items'),
  };
  // Mark first, so a half finished load can always be cleaned up.
  await loadSettings(ctx.orgId);
  await db.update(settings).set({ sampleLoadedAt: new Date() }).where(eq(settings.orgId, ctx.orgId));
  let built: { jobs: number; entries: number };
  try {
    built = await buildSampleShop(ctx);
    // Goals only when the workspace has none of its own (a goal is one per scope and measure).
    const [goals] = await rows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM pulse.targets WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND scope = 'org'`);
    if ((goals?.n ?? 0) === 0) {
      await saveTarget(ctx, { scope: 'org', metric: 'margin_pct', value: '30', isSample: true });
      await saveTarget(ctx, { scope: 'org', metric: 'units_per_labor_hour', value: '40', isSample: true });
    }
  } catch (error) {
    await markSample(ctx, before);
    await clearSampleData(ctx).catch(() => undefined);
    throw error;
  }
  await markSample(ctx, before);
  await logActivity(db, ctx, { verb: 'sample.loaded', entityType: 'sample', after: { jobs: built.jobs, entries: built.entries } });
  await evaluateAlerts(ctx).catch(() => undefined);
  return getSampleState(ctx);
});

/** Remembers which labor classes and job types the sample made (they have no sample mark of their own) and marks the items and services. */
async function markSample(ctx: DomainContext, before: { labor_classes: Set<string>; job_types: Set<string>; vas_services: Set<string>; items: Set<string> }): Promise<void> {
  const fresh = async (table: 'labor_classes' | 'job_types' | 'vas_services' | 'items'): Promise<string[]> => [...(await idsOf(db, ctx.orgId, table))].filter((id) => !before[table].has(id));
  const [classes, types, services, items] = [await fresh('labor_classes'), await fresh('job_types'), await fresh('vas_services'), await fresh('items')];
  if (services.length > 0) await db.execute(sql`UPDATE pulse.vas_services SET is_sample = true, source = 'sample' WHERE org_id = ${ctx.orgId} AND id = ANY(${uuidArray(services)})`);
  if (items.length > 0) await db.execute(sql`UPDATE pulse.items SET is_sample = true, source = 'sample' WHERE org_id = ${ctx.orgId} AND id = ANY(${uuidArray(items)})`);
  await db.execute(sql`UPDATE pulse.settings SET onboarding = onboarding || ${JSON.stringify({ sample: { laborClassIds: classes, jobTypeIds: types } })}::jsonb WHERE org_id = ${ctx.orgId}`);
}

/** Deletes one row unless something real still points at it. Returns true when it is gone. */
async function deleteIfFree(tx: Executor, table: string, id: string): Promise<boolean> {
  try {
    await (tx as unknown as { transaction: <T>(fn: (inner: Executor) => Promise<T>) => Promise<T> }).transaction(async (inner) => {
      await inner.execute(sql`DELETE FROM pulse.${sql.raw(table)} WHERE id = ${id}`);
    });
    return true;
  } catch {
    return false;
  }
}

/** Takes every sample row out again. Work somebody logged on a sample job goes with the job. */
export const clearSampleData = scoped(async function clearSampleData(ctx: DomainContext): Promise<SampleStateDTO> {
  await requirePulse(ctx, 'sample:manage');
  await inTx(async (tx) => {
    await tx.execute(sql`SET LOCAL pulse.allow_purge = 'on'`);
    const org = ctx.orgId;
    const row = await loadSettings(org, tx);
    const jobIds = (await rows<{ id: string }>(tx, sql`SELECT id FROM pulse.jobs WHERE org_id = ${org} AND is_sample`)).map((item) => item.id);
    const jobs = uuidArray(jobIds);
    for (const table of ['production_entries', 'material_usage', 'cost_entries', 'revenue_entries', 'vas_entries', 'time_punches']) {
      await tx.execute(sql`DELETE FROM pulse.${sql.raw(table)} WHERE org_id = ${org} AND (is_sample OR job_id = ANY(${jobs}))`);
    }
    for (const table of ['indirect_entries', 'paid_hours', 'standards', 'targets', 'labor_rates']) {
      await tx.execute(sql`DELETE FROM pulse.${sql.raw(table)} WHERE org_id = ${org} AND is_sample`);
    }
    if (jobIds.length > 0) {
      for (const table of ['job_plan_lines', 'job_plans', 'job_prices', 'job_links', 'job_stats', 'fact_days', 'notifications', 'quote_scenarios']) {
        await tx.execute(sql`DELETE FROM pulse.${sql.raw(table)} WHERE org_id = ${org} AND job_id = ANY(${jobs})`);
      }
      await tx.execute(sql`DELETE FROM pulse.alerts WHERE org_id = ${org} AND entity_type = 'job' AND entity_id = ANY(${sql`ARRAY[${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)}]::text[]`})`);
      await tx.execute(sql`DELETE FROM pulse.jobs WHERE org_id = ${org} AND id = ANY(${jobs})`);
    }
    // Clients, items and services go unless real work uses them: then they stay and lose the sample mark.
    for (const table of ['items', 'vas_services', 'clients'] as const) {
      const found = await rows<{ id: string }>(tx, sql`SELECT id FROM pulse.${sql.raw(table)} WHERE org_id = ${org} AND is_sample`);
      if (table === 'clients') {
        await tx.execute(sql`DELETE FROM pulse.fact_days WHERE org_id = ${org} AND client_id = ANY(${uuidArray(found.map((item) => item.id))})`);
        await tx.execute(sql`DELETE FROM pulse.alerts WHERE org_id = ${org} AND entity_type = 'client' AND entity_id = ANY(${found.length > 0 ? sql`ARRAY[${sql.join(found.map((item) => sql`${item.id}`), sql`, `)}]::text[]` : sql`ARRAY[]::text[]`})`);
      }
      for (const item of found) {
        if (!(await deleteIfFree(tx, table, item.id))) await tx.execute(sql`UPDATE pulse.${sql.raw(table)} SET is_sample = false WHERE id = ${item.id}`);
      }
    }
    const tracked = ((row.onboarding ?? {}) as { sample?: { laborClassIds?: unknown; jobTypeIds?: unknown } }).sample ?? {};
    const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) : []);
    for (const id of list(tracked.jobTypeIds)) await deleteIfFree(tx, 'job_types', id);
    for (const id of list(tracked.laborClassIds)) await deleteIfFree(tx, 'labor_classes', id);
    // Entries with no labor class follow the default class, so there must always be one while classes exist.
    await tx.execute(sql`
      UPDATE pulse.labor_classes SET is_default = true
       WHERE id = (SELECT id FROM pulse.labor_classes WHERE org_id = ${org} AND deleted_at IS NULL ORDER BY created_at LIMIT 1)
         AND NOT EXISTS (SELECT 1 FROM pulse.labor_classes WHERE org_id = ${org} AND deleted_at IS NULL AND is_default)`);
    await tx.execute(sql`DELETE FROM pulse.company_days WHERE org_id = ${org}`);
    await tx.execute(sql`UPDATE pulse.settings SET sample_loaded_at = NULL, onboarding = onboarding - 'sample' WHERE org_id = ${org}`);
    await recalcOrg(tx, ctx);
    await logActivity(tx, ctx, { verb: 'sample.cleared', entityType: 'sample', before: { jobs: jobIds.length } });
  });
  await evaluateAlerts(ctx).catch(() => undefined);
  return getSampleState(ctx);
});

/** Tables emptied by "Delete all Pulse data", children before parents. Settings, sites, people, alert rules and the audit log stay. */
const PURGE_ORDER = [
  'notifications',
  'alerts',
  'fact_days',
  'company_days',
  'day_reviews',
  'periods',
  'import_rows',
  'import_batches',
  'import_presets',
  'report_runs',
  'report_schedules',
  'sync_runs',
  'sync_state',
  'dismissals',
  'bridge_events',
  'saved_views',
  'quote_scenarios',
  'job_stats',
  'job_links',
  'job_plan_lines',
  'job_plans',
  'job_prices',
  'production_entries',
  'indirect_entries',
  'paid_hours',
  'time_punches',
  'material_usage',
  'cost_entries',
  'revenue_entries',
  'vas_entries',
  'standards',
  'targets',
  'jobs',
  'labor_rates',
  'items',
  'vas_services',
] as const;

/**
 * Owner only: deletes every job, client, entry, rate, plan, goal, import and report of the
 * workspace, closed months included. Settings, sites, people and their roles, alert rules and the
 * audit log are kept. `confirm` must be the workspace slug, typed by the person.
 */
export const purgeAllData = scoped(async function purgeAllData(ctx: DomainContext, confirm: string): Promise<{ deleted: number }> {
  await requirePulse(ctx, 'data:purge');
  if (confirm.trim().toLowerCase() !== ctx.orgSlug.toLowerCase()) throw invalid(`Type ${ctx.orgSlug} to confirm.`, { confirm: `Type ${ctx.orgSlug} to confirm.` });
  return inTx(async (tx) => {
    await tx.execute(sql`SET LOCAL pulse.allow_purge = 'on'`);
    let deleted = 0;
    for (const table of PURGE_ORDER) {
      const result = await tx.execute(sql`DELETE FROM pulse.${sql.raw(table)} WHERE org_id = ${ctx.orgId}`);
      deleted += result.rowCount ?? 0;
    }
    deleted += (await tx.execute(sql`DELETE FROM pulse.job_types WHERE org_id = ${ctx.orgId} AND NOT is_builtin`)).rowCount ?? 0;
    deleted += (await tx.execute(sql`DELETE FROM pulse.labor_classes WHERE org_id = ${ctx.orgId}`)).rowCount ?? 0;
    deleted += (await tx.execute(sql`DELETE FROM pulse.clients WHERE org_id = ${ctx.orgId}`)).rowCount ?? 0;
    await tx.execute(sql`UPDATE pulse.settings SET sample_loaded_at = NULL, onboarding = '{}'::jsonb, job_seq = 1000 WHERE org_id = ${ctx.orgId}`);
    await logActivity(tx, ctx, { verb: 'data.purged', entityType: 'data', after: { rows: deleted } });
    return { deleted };
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Getting started: the five steps                                                             */
/* ------------------------------------------------------------------------------------------ */

export interface OnboardingStateDTO {
  /** The five steps to a first profit number, each true once real data shows it is done. */
  readonly steps: { readonly rate: boolean; readonly client: boolean; readonly job: boolean; readonly day: boolean; readonly profit: boolean };
  readonly done: number;
  /** The first labor class and its real cost of an hour in effect today (null when hidden or not set). */
  readonly rate: { readonly name: string; readonly loadedRateCents: number | null } | null;
  readonly client: { readonly id: string; readonly name: string } | null;
  /** The job the guided steps use: the newest job that is not sample data. */
  readonly job: { readonly id: string; readonly number: string; readonly name: string; readonly unitLabel: string } | null;
  /** The first profit number, for the whole job so far: null money when the reader may not see it. */
  readonly profit: { readonly jobId: string; readonly jobNumber: string; readonly revenueCents: number | null; readonly costCents: number | null; readonly profitCents: number | null; readonly marginBp: number | null; readonly unitsGood: string; readonly hours: string } | null;
  readonly site: { readonly id: string; readonly name: string; readonly timezone: string; readonly today: string } | null;
  readonly sample: SampleStateDTO;
  readonly moneyHidden: boolean;
}

/** Where a workspace is on the way to its first profit number. Sample rows do not count as your own steps. */
export const getOnboardingState = scoped(async function getOnboardingState(ctx: DomainContext): Promise<OnboardingStateDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  const row = await loadSettings(ctx.orgId);
  const org = ctx.orgId;
  const [site] = await listSites(ctx);
  // The first labor class that got a rate, with the rate in effect today: an old rate that a newer
  // one replaced is never quoted. A class whose only rates start later shows the first of those.
  const today = site?.today ?? todayInZone(row.timezone);
  const [rate] = await rows<{ name: string; loaded: number }>(
    db,
    sql`SELECT lc.name, r.loaded_rate_cents AS loaded FROM pulse.labor_rates r JOIN pulse.labor_classes lc ON lc.id = r.labor_class_id
         WHERE r.org_id = ${org} AND r.deleted_at IS NULL AND NOT r.is_sample
           AND r.labor_class_id = (SELECT f.labor_class_id FROM pulse.labor_rates f
                                    WHERE f.org_id = ${org} AND f.deleted_at IS NULL AND NOT f.is_sample ORDER BY f.created_at, f.effective_from, f.id LIMIT 1)
         ORDER BY (r.effective_from <= ${today}::date) DESC, (r.site_id IS NULL) DESC,
                  CASE WHEN r.effective_from <= ${today}::date THEN r.effective_from END DESC NULLS LAST, r.effective_from
         LIMIT 1`,
  );
  const [client] = await rows<{ id: string; name: string }>(db, sql`SELECT id, name FROM pulse.clients WHERE org_id = ${org} AND deleted_at IS NULL AND NOT is_sample ORDER BY created_at LIMIT 1`);
  const [job] = await rows<{ id: string; number: string; name: string; unit_label: string }>(
    db,
    sql`SELECT j.id, j.number, j.name, j.unit_label FROM pulse.jobs j
         WHERE j.org_id = ${org} AND j.deleted_at IS NULL AND NOT j.is_sample
         ORDER BY EXISTS (SELECT 1 FROM pulse.production_entries p WHERE p.job_id = j.id AND p.deleted_at IS NULL) DESC, j.created_at LIMIT 1`,
  );
  const [made] = await rows<{ job_id: string; number: string; revenue: string; cost: string; profit: string; margin: number | null; units: string; hours: string }>(
    db,
    sql`SELECT s.job_id, j.number, s.revenue_cents::text AS revenue, s.cost_cents::text AS cost, s.profit_cents::text AS profit, s.margin_bp AS margin, s.units_good::text AS units, s.hours::text AS hours
          FROM pulse.job_stats s JOIN pulse.jobs j ON j.id = s.job_id
         WHERE s.org_id = ${org} AND j.deleted_at IS NULL AND NOT j.is_sample AND s.entry_count > 0
         ORDER BY j.created_at LIMIT 1`,
  );
  const hasFallbackRate = row.defaultLoadedRateCents !== null;
  const steps = { rate: Boolean(rate) || hasFallbackRate, client: Boolean(client), job: Boolean(job), day: Boolean(made), profit: Boolean(made) && Number(made?.revenue ?? 0) !== 0 };
  const money = access.seesMoney;
  return {
    steps,
    done: Object.values(steps).filter(Boolean).length,
    rate: rate ? { name: rate.name, loadedRateCents: money ? rate.loaded : null } : hasFallbackRate ? { name: 'Every hour', loadedRateCents: money ? row.defaultLoadedRateCents : null } : null,
    client: client ?? null,
    job: job ? { id: job.id, number: job.number, name: job.name, unitLabel: job.unit_label } : null,
    profit: made ? { jobId: made.job_id, jobNumber: made.number, revenueCents: money ? Number(made.revenue) : null, costCents: money ? Number(made.cost) : null, profitCents: money ? Number(made.profit) : null, marginBp: money ? made.margin : null, unitsGood: made.units, hours: made.hours } : null,
    site: site ? { id: site.id, name: site.name, timezone: site.timezone, today: site.today } : null,
    sample: await getSampleState(ctx),
    moneyHidden: !money,
  };
});
