/**
 * Rich demo seed engine. Turns an `OrgPlan` into 90 days of believable work, written through the
 * domain layer so stamps, rollups, numbering and the activity log are all real.
 *
 * Numbers come from a seeded generator keyed by the plan and the job, so every run gives the same
 * data relative to today. Sibling records (WMS work orders, CRM deals and accounts, Projects
 * projects, core customers) are looked up by code or name at run time and skipped quietly when
 * missing. The only direct SQL here is seed housekeeping the domain has no call for: reading
 * sibling ids, and moving timestamps back so the history does not all say "today".
 */
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { centsToNumber } from '@/lib/money';
import { addDays, addWorkDays, endOfMonth, isWorkDay, loadedRate, planSharedAuto, startOfMonth, weekday } from '@/lib/profit';
import {
  addNote,
  closePeriod,
  createAlertRule,
  createClient,
  createItem,
  createJob,
  createJobType,
  createLaborClass,
  createLaborRate,
  createSite,
  createVasService,
  deleteProductionEntries,
  evaluateAlerts,
  listAlerts,
  listJobs,
  listNotifications,
  listProduction,
  listSites,
  markDayComplete,
  markNotificationsRead,
  recomputeJobs,
  recordRecentJob,
  restoreProductionEntries,
  reviewDay,
  rows,
  saveCost,
  saveIndirectEntry,
  saveMaterialUsage,
  savePaidHours,
  savePlan,
  saveProductionBulk,
  saveProductionEntry,
  saveRevenue,
  saveStandard,
  saveTarget,
  saveVasEntry,
  saveView,
  setJobPrice,
  setJobStatus,
  setMemberRole,
  updateAlert,
  updateSettings,
  updateSite,
  type DomainContext,
  type JobLinkInput,
  type PlanInput,
  type ProductionInput,
} from '@/server/domain';
import { ensureDemoLogin, orgMembers } from '../context';
import type { ClassSpec, JobSpec, OrgPlan } from './types';

/* ------------------------------------------------------------------ small helpers */

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seeded generator (mulberry32). */
function rng(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (r: () => number, low: number, high: number): number => low + (high - low) * r();
const h2 = (value: number): string => (Math.round(value * 4) / 4).toFixed(2);
const q = (value: number): string => String(Math.max(0, Math.round(value)));

function nice(value: number, down = false): number {
  const step = value >= 20000 ? 1000 : value >= 4000 ? 500 : value >= 800 ? 100 : value >= 200 ? 50 : value >= 60 ? 10 : value >= 20 ? 5 : 1;
  return Math.max(step, (down ? Math.floor(value / step) : Math.round(value / step)) * step);
}

function nicePrice(value: number): number {
  const step = value < 3 ? 0.05 : value < 20 ? 0.25 : value < 100 ? 1 : 5;
  return Math.max(step, Math.round(value / step) * step);
}

async function quiet<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

interface Day {
  /** Work day offset from today (0 is today). Saturdays carry the offset of the Friday before. */
  i: number;
  date: string;
  saturday?: boolean;
}

interface SimDay {
  date: string;
  i: number;
  j: number;
  units: number;
  scrap: number;
  hours: number;
}

interface Sim {
  spec: JobSpec;
  rows: (ProductionInput & { i: number })[];
  days: SimDay[];
  units: number;
  hours: number;
  first: number;
  last: number;
  planned: number;
  price: number;
  revenueCents: number;
  quote: PlanInput;
  jobId: string;
}

export interface RichSummary {
  readonly org: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly statuses: Readonly<Record<string, number>>;
  readonly story: readonly { number: string; name: string; status: string; expect: string; ok: boolean; margin: string; headline: string }[];
  readonly months: readonly { month: string; revenue: number; profit: number; marginPct: string; closed: boolean }[];
  readonly clients: readonly { name: string; revenue: number; profit: number; marginPct: string }[];
  readonly services: readonly { name: string; revenue: number; profit: number; marginPct: string }[];
  readonly reconciled: boolean;
  readonly alerts: Readonly<Record<string, number>>;
  readonly ms: number;
}

/* ------------------------------------------------------------------ the engine */

export async function seedRich(ctx: DomainContext, plan: OrgPlan): Promise<RichSummary> {
  const started = Date.now();
  const log = (text: string): void => void process.stdout.write(`  [${ctx.orgSlug}] ${text}\n`);
  for (const role of plan.roles) if (role.login) await ensureDemoLogin(ctx.orgId, { email: role.email, ...role.login });
  const members = await orgMembers(ctx.orgId);
  const userId = (email: string | undefined): string | null => members.find((member) => member.email === email)?.id ?? null;

  /* 1. Setup rows */
  await updateSettings(ctx, { defaultLoadedRateCents: 2400, defaultPartsOwner: plan.defaultPartsOwner, sharedCostRule: 'by_labor_hours', sharedSpread: 'week' });
  const [firstSite] = await listSites(ctx);
  if (!firstSite) throw new Error('Seed: the org has no site.');
  const siteIds = new Map<string, string>();
  for (const [index, site] of plan.sites.entries()) {
    const row = index === 0 ? await updateSite(ctx, firstSite.id, { code: site.code, name: site.name, timezone: site.timezone }) : await createSite(ctx, { code: site.code, name: site.name, timezone: site.timezone });
    siteIds.set(site.code, row.id);
  }
  const mainSiteId = siteIds.get(plan.sites[0]!.code)!;
  const today = (await listSites(ctx))[0]!.today;
  for (const role of plan.roles) {
    const id = userId(role.email);
    // People the role list does not show (client portal and API users) are skipped.
    if (id && id !== ctx.userId) await setMemberRole(ctx, id, { role: role.role, seesMoney: role.seesMoney }).catch(() => log(`role for ${role.email} skipped`));
  }

  // Calendar: every work day of the last 90 days, oldest first.
  const days: Day[] = [];
  for (let date = addDays(today, -90); date <= today; date = addDays(date, 1)) if (isWorkDay(date)) days.push({ i: 0, date });
  days.forEach((day, index) => (day.i = index - (days.length - 1)));
  const firstIndex = days[0]!.i;
  const dayAt = (i: number): string => (i <= 0 ? days[Math.max(0, i - firstIndex)]!.date : (addWorkDays(today, i) ?? today));
  const closed = new Set(plan.closed);
  const months = [...new Set(days.map((day) => startOfMonth(day.date)))];
  const monthFactor = (date: string): number => [1, 0.96, 1.0, 1.02, 1.02][months.indexOf(startOfMonth(date))] ?? 1;
  const rateStart = addDays(today, -400);
  const raiseDay = addDays(today, -45);
  /** History is saved in two parts, so alerts raised by the first part can clear after the second. */
  const cut = -11;

  const classIds = new Map<string, string>();
  const oldRate = new Map<string, number>();
  const newRate = new Map<string, number>();
  const rateInput = (spec: ClassSpec, wage: number) => ({ wageCents: wage, payrollTaxBp: spec.taxBp, benefitsBp: spec.benBp, otherBurdenBp: 0, overheadPerHourCents: spec.overhead, overtimeMultiplier: '1.50' });
  for (const spec of plan.classes) {
    const row = await createLaborClass(ctx, { code: spec.code, name: spec.name, kind: spec.kind, isDefault: spec.isDefault, color: spec.color });
    classIds.set(spec.code, row.id);
    const raised = Math.round((spec.wage * (100 + spec.raisePct)) / 100 / 5) * 5;
    await createLaborRate(ctx, { laborClassId: row.id, effectiveFrom: rateStart, ...rateInput(spec, spec.wage), note: 'Starting rate' });
    await createLaborRate(ctx, { laborClassId: row.id, effectiveFrom: raiseDay, ...rateInput(spec, raised), note: spec.kind === 'temp_agency' ? 'The agency raised its bill rate' : 'Yearly raise' });
    oldRate.set(spec.code, centsToNumber(loadedRate(rateInput(spec, spec.wage)).loadedRateCents) / 100);
    newRate.set(spec.code, centsToNumber(loadedRate(rateInput(spec, raised)).loadedRateCents) / 100);
  }
  const leadClass = plan.classes.find((spec) => spec.isLead);
  const defaultClass = plan.classes.find((spec) => spec.isDefault) ?? plan.classes[0]!;

  const typeIds = new Map<string, string>();
  for (const [index, spec] of plan.types.entries()) {
    const row = await createJobType(ctx, { code: spec.code, name: spec.name, unitLabel: spec.unit, defaultLaborClassId: classIds.get(spec.cls), targetMarginBp: spec.target, color: spec.color, icon: spec.icon, position: index + 1 });
    typeIds.set(spec.code, row.id);
    await saveStandard(ctx, { jobTypeId: row.id, unitsPerLaborHour: spec.pace.toFixed(3), effectiveFrom: rateStart, basis: index % 3 === 0 ? 'time_study' : 'typed', note: index % 3 === 0 ? 'From the spring time study' : 'Starting target pace' });
  }
  const serviceIds = new Map<string, string>();
  for (const spec of plan.services) {
    const row = await createVasService(ctx, { code: spec.code, name: spec.name, unitLabel: spec.unit, billing: spec.billing ?? 'per_unit', defaultPrice: spec.price, defaultCostPerUnit: spec.cost ?? '0', standardUph: spec.uph.toFixed(3), defaultLaborClassId: classIds.get(spec.cls ?? defaultClass.code), color: spec.color });
    serviceIds.set(spec.code, row.id);
    await saveStandard(ctx, { vasServiceId: row.id, unitsPerLaborHour: spec.uph.toFixed(3), effectiveFrom: rateStart, basis: 'typed' });
  }

  // Clients, linked to core customers or CRM accounts when those exist.
  const core = await quiet(() => rows<{ id: string; code: string }>(db, sql`SELECT id, code FROM core.customers WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL`), []);
  const accounts = await quiet(
    () => rows<{ id: string; name: string; board_id: string }>(db, sql`SELECT i.id, i.name, i.board_id FROM crm.items i JOIN crm.boards b ON b.id = i.board_id WHERE i.org_id = ${ctx.orgId} AND b.kind = 'accounts' AND i.deleted_at IS NULL`),
    [],
  );
  const deals = await quiet(
    () =>
      rows<{ id: string; name: string; board_id: string; amount: string | null }>(
        db,
        sql`SELECT i.id, i.name, i.board_id, i.values->'deal_value'->>'amount' AS amount FROM crm.items i JOIN crm.boards b ON b.id = i.board_id
             WHERE i.org_id = ${ctx.orgId} AND b.kind = 'deals' AND i.deleted_at IS NULL AND i.values->'stage'->>'labelId' = 'won'`,
      ),
    [],
  );
  const projects = await quiet(() => rows<{ id: string; key: string; name: string; status: string }>(db, sql`SELECT id, key, name, status FROM pm.projects WHERE org_id = ${ctx.orgId}`), []);
  const workOrders = await quiet(
    () => rows<{ id: string; code: string; status: string; note: string | null; day: string | null }>(db, sql`SELECT id::text, code, status, extra_note AS note, to_char(COALESCE(actual_finish_at, planned_start_at)::timestamptz, 'YYYY-MM-DD') AS day FROM wms.work_orders`),
    [],
  );
  const hasWms = plan.jobs.some((job) => job.wms) && workOrders.length > 0;

  const clientIds = new Map<string, string>();
  for (const spec of plan.clients) {
    const customer = core.find((row) => row.code === spec.core);
    const account = accounts.find((row) => row.name === spec.crmAccount);
    const row = await createClient(ctx, {
      code: spec.code,
      name: spec.name,
      contactName: spec.contact,
      contactEmail: spec.email,
      status: spec.inactive ? 'inactive' : 'active',
      partsOwner: spec.owner ?? null,
      targetMarginBp: spec.target ?? null,
      paymentTermsDays: spec.terms ?? 30,
      color: spec.color,
      notes: spec.notes ?? null,
      coreCustomerId: customer?.id ?? null,
      crmAccountItemId: account?.id ?? null,
      source: customer ? 'wms' : account ? 'crm' : 'manual',
      sourceRef: customer?.id ?? account?.id ?? null,
    });
    clientIds.set(spec.code, row.id);
  }
  for (const spec of plan.items) {
    await createItem(ctx, { sku: spec.sku, name: spec.name, uom: spec.uom ?? 'each', unitCost: spec.cost, suppliedBy: spec.by ?? null, clientId: spec.client ? clientIds.get(spec.client) : null });
  }
  const itemSpec = new Map(plan.items.map((item) => [item.sku, item]));
  const typeSpec = new Map(plan.types.map((type) => [type.code, type]));
  log(`setup done: ${plan.classes.length} labor classes, ${plan.types.length} job types, ${plan.services.length} services, ${plan.clients.length} clients`);

  /* 2. Work out every job's days, then create the jobs */
  const saturdays: string[] = [];
  for (let date = addDays(today, -1); date >= days[0]!.date; date = addDays(date, -1)) if (weekday(date) === 6) saturdays.push(date);

  function simulate(spec: JobSpec): Omit<Sim, 'jobId'> {
    const r = rng(`${plan.seed}:${spec.n}`);
    const type = typeSpec.get(spec.type)!;
    const cls = spec.cls ?? type.cls;
    const runs = spec.status !== 'planned' && spec.status !== 'cancelled' && spec.crew > 0;
    const first = Math.max(firstIndex, spec.start);
    const last = !runs ? first - 1 : spec.len !== undefined ? Math.min(spec.status === 'active' ? 0 : -1, first + spec.len - 1) : (spec.last ?? 0);
    const n = last - first + 1;
    const hrs = spec.hrs ?? 7.5;
    const withLead = Boolean(leadClass) && spec.crew >= 5;
    const out: (ProductionInput & { i: number })[] = [];
    const simDays: SimDay[] = [];
    const push = (day: Day, j: number, saturday: boolean): void => {
      const people = saturday ? Math.max(2, Math.round(spec.crew / 2)) : spec.crew >= 5 && r() < 0.14 ? spec.crew - 1 : spec.crew;
      const each = saturday ? 5 : hrs;
      const setup = j === 0 && !saturday ? (spec.setup ?? 0) : 0;
      const leadHours = saturday ? 0 : withLead ? 4 : spec.help ? 3 : 0;
      const overtime = saturday ? people * each : spec.overtime && r() < spec.overtime ? Math.round(people * 1.5) : 0;
      const hours = saturday ? people * each : people * each + overtime;
      const dow = weekday(day.date) === 1 ? 0.97 : weekday(day.date) === 5 ? 0.98 : 1;
      const pace = spec.pace * (spec.paceFn?.(j, n) ?? 1) * monthFactor(day.date) * dow * between(r, 0.945, 1.065);
      const units = Math.max(1, Math.round((hours - setup + leadHours) * pace));
      const scrap = Math.round(units * (spec.scrap ?? 0.008) * between(r, 0.5, 1.6));
      const missing = !saturday && (spec.noHours ?? []).includes(j);
      out.push({
        i: day.i,
        jobId: '',
        workDate: day.date,
        laborClassId: classIds.get(cls)!,
        unitsGood: q(units),
        unitsScrap: q(scrap),
        headcount: missing ? null : String(people),
        hours: missing ? '0' : h2(hours),
        overtimeHours: missing ? '0' : h2(overtime),
        setupHours: missing ? '0' : h2(setup),
        hoursConfirmed: !missing,
        note: saturday ? 'Saturday shift to catch up' : setup > 0 ? 'First day: line setup and training' : null,
      });
      if (leadHours > 0 && !missing) out.push({ i: day.i, jobId: '', workDate: day.date, laborClassId: classIds.get(withLead ? leadClass!.code : spec.help!)!, headcount: '1', hours: h2(leadHours) });
      simDays.push({ date: day.date, i: day.i, j, units, scrap, hours: missing ? 0 : hours + leadHours });
    };
    for (let i = first; i <= last; i += 1) {
      const j = i - first;
      if (closed.has(i) || (spec.skip ?? []).includes(j)) continue;
      push({ i, date: dayAt(i) }, j, false);
    }
    for (const date of saturdays.slice(0, spec.sat ?? 0)) {
      const friday = days.find((day) => day.date === addDays(date, -1));
      if (friday && friday.i >= first && friday.i <= last) push({ i: friday.i, date, saturday: true }, friday.i - first, true);
    }
    simDays.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let units = simDays.reduce((sum, day) => sum + day.units, 0);
    const hours = simDays.reduce((sum, day) => sum + day.hours, 0);
    let planned = spec.planned ?? 0;
    if (units > 0) {
      if (spec.ongoing) planned = spec.planned ?? nice((units / Math.max(1, simDays.length)) * 23);
      else if (spec.status === 'active') planned = spec.planned ?? nice(units / (spec.pct ?? 0.5));
      else {
        // A finished job made exactly what was ordered: trim the last day to a round number.
        const lastDay = simDays[simDays.length - 1]!;
        // Round down by a step that is small next to one day of work, so the last day still looks like a day.
        const step = [1000, 500, 100, 50, 10, 5].find((size) => size <= lastDay.units * 0.2) ?? 1;
        const wanted = spec.planned ?? Math.floor(units / step) * step;
        const extra = units - wanted;
        if (extra > 0 && extra < lastDay.units) {
          lastDay.units -= extra;
          units = wanted;
          const row = out.filter((entry) => entry.workDate === lastDay.date && entry.unitsGood !== undefined).pop();
          if (row) row.unitsGood = q(lastDay.units);
        }
        planned = spec.planned ?? (extra >= 0 && units === wanted ? wanted : units);
      }
    }
    // Price from the margin the quote aimed for.
    // A job quoted after the raise was quoted on the new rate.
    const quotedOn = (code: string): number => ((spec.start > 0 ? today : dayAt(first)) >= raiseDay ? newRate : oldRate).get(code) ?? 24;
    const rate = quotedOn(cls);
    const quotePace = spec.quotePace ?? spec.pacePlan ?? type.pace;
    const pricing = spec.pricing ?? 'per_unit';
    const ownMaterial = spec.items ? spec.items.reduce((sum, line) => sum + (itemSpec.get(line.sku)?.by === 'client' ? 0 : line.per * Number(itemSpec.get(line.sku)?.cost ?? 0)), 0) : (spec.matPlan ?? spec.mat ?? 0);
    const base = Math.max(1, planned);
    const laborHours = base / quotePace;
    const setupHours = spec.setup ?? 0;
    const otherPlan = spec.otherPlan ?? (spec.other ?? []).reduce((sum, cost) => sum + cost.cents, 0) / 100;
    // 5% on top for the small things a quote never lists.
    const costPerUnit = (((laborHours + setupHours) * rate * 1.09 + otherPlan) / base + ownMaterial) * 1.05;
    const price = pricing === 'hourly' ? (spec.price ?? nicePrice((rate * 1.09 * 1.05) / (1 - (spec.qm ?? 0.3)))) : (spec.price ?? nicePrice(costPerUnit / (1 - (spec.qm ?? 0.3))));
    const revenueCents = pricing === 'hourly' ? Math.round((laborHours + setupHours) * price * 100) : pricing === 'fixed' ? Math.round((price * base) / 100) * 10000 : Math.round(price * base * 100);
    // Extra services planned on the job are part of its plan: their hours, supplies and revenue.
    let serviceHours = 0;
    let serviceLabor = 0;
    let serviceSupplies = 0;
    let serviceRevenue = 0;
    for (const line of spec.vas ?? []) {
      const service = plan.services.find((item) => item.code === line.svc)!;
      // Same share of days as the entries will have, with a little room for supplies.
      const every = line.every ?? 3;
      const quantity = base * line.share * (simDays.length > 0 ? simDays.filter((day) => day.j % every === 0).length / simDays.length : 1 / every);
      serviceHours += quantity / service.uph;
      serviceLabor += (quantity / service.uph) * quotedOn(service.cls ?? defaultClass.code);
      serviceSupplies += quantity * Number(service.cost ?? 0) * 1.06;
      serviceRevenue += quantity * Number(line.price ?? service.price);
    }
    const quote: PlanInput = {
      units: q(planned),
      revenueCents: revenueCents + Math.round(serviceRevenue * 100),
      laborHours: (laborHours + setupHours + serviceHours).toFixed(2),
      laborCents: Math.round(((laborHours + setupHours) * rate + serviceLabor) * 100),
      setupHours: h2(setupHours),
      setupCents: Math.round(setupHours * rate * 100),
      materialCents: Math.round((ownMaterial * base + serviceSupplies) * 100),
      otherCents: Math.round(otherPlan * 100),
      origin: spec.deal ? 'crm_deal' : 'typed',
      note: spec.deal ? 'Kit build share of the won deal' : null,
    };
    return { spec, rows: out, days: simDays, units, hours, first, last, planned, price, revenueCents, quote };
  }

  const sims: Sim[] = [];
  for (const planned of plan.jobs) {
    // A warehouse job sits on the day its work order ran.
    const order = workOrders.find((row) => row.code === planned.wms);
    const orderDay = order?.day ? days.find((day) => day.date >= order.day!) : undefined;
    const spec: JobSpec = orderDay ? { ...planned, start: orderDay.i } : planned;
    const sim = simulate(spec);
    const type = typeSpec.get(spec.type)!;
    const pricing = spec.pricing ?? 'per_unit';
    const links: JobLinkInput[] = [];
    if (order) links.push({ targetType: 'wms_work_order', targetId: order.id, title: `${order.code} ${order.note ?? ''}`.trim(), status: order.status, url: `/work-orders/${order.id}` });
    const deal = deals.find((row) => row.name === spec.deal);
    if (deal) {
      links.push({ targetType: 'crm_deal', targetId: deal.id, title: deal.name, status: 'Won', url: `/${ctx.orgSlug}/boards/${deal.board_id}?item=${deal.id}&itemTab=pulse` });
      sim.quote.originRef = deal.id;
    } else if (spec.deal) sim.quote.origin = 'typed';
    const project = projects.find((row) => row.key === spec.project);
    if (project) links.push({ targetType: 'pm_project', targetId: project.id, title: project.name, status: project.status, url: `/p/${project.key}`, importsTime: Boolean(spec.importsTime) });
    const startDate = sim.spec.status === 'planned' ? dayAt(spec.start) : dayAt(sim.first);
    const dailyUnits = sim.days.length > 0 ? sim.units / sim.days.length : 0;
    const daysLeft = dailyUnits > 0 ? Math.ceil(Math.max(0, sim.planned - sim.units) / dailyUnits) : 0;
    const dueDate =
      spec.due !== undefined ? dayAt(spec.due) : spec.ongoing ? null : spec.status === 'active' ? dayAt(daysLeft + 5) : spec.status === 'planned' ? dayAt(spec.start + (spec.len ?? 10) + 2) : dayAt(Math.min(0, sim.last + 2));
    const created = await createJob(ctx, {
      number: spec.n,
      name: spec.name,
      clientId: clientIds.get(spec.client)!,
      jobTypeId: typeIds.get(spec.type)!,
      siteId: siteIds.get(spec.site ?? plan.sites[0]!.code),
      kind: spec.ongoing ? 'ongoing' : 'one_time',
      status: spec.status === 'planned' ? 'planned' : 'active',
      pricingModel: pricing,
      // An ongoing program has no end count: its plan is read as one month of work.
      plannedUnits: spec.ongoing ? '0' : q(sim.planned),
      unitPrice: pricing === 'per_unit' && !spec.noPrice ? sim.price.toFixed(4) : null,
      fixedPriceCents: pricing === 'fixed' ? sim.revenueCents : null,
      billRateCents: pricing === 'hourly' ? Math.round(sim.price * 100) : null,
      materialMethod: spec.items ? 'actual' : 'standard',
      materialCostPerUnit: (spec.mat ?? 0).toFixed(4),
      partsOwner: spec.owner ?? null,
      defaultLaborClassId: classIds.get(spec.cls ?? type.cls),
      usualCrew: spec.crew > 0 ? [{ laborClassId: classIds.get(spec.cls ?? type.cls)!, headcount: spec.crew }, ...(leadClass && spec.crew >= 5 ? [{ laborClassId: classIds.get(leadClass.code)!, headcount: 1 }] : [])] : [],
      standardUph: spec.pacePlan ? spec.pacePlan.toFixed(3) : null,
      targetMarginBp: spec.target ?? null,
      startDate,
      dueDate,
      poNumber: spec.po ?? null,
      ownerId: userId(spec.ownerEmail) ?? ctx.userId,
      description: spec.description ?? null,
      pinnedNote: spec.pinned ?? null,
      quote: spec.noPrice ? null : sim.quote,
      links,
      source: order ? 'wms' : 'manual',
      sourceRef: order?.id ?? null,
    });
    if (spec.budget) {
      await savePlan(ctx, created.id, 'budget', { ...sim.quote, laborHours: h2(Number(sim.quote.laborHours) * 1.04), laborCents: Math.round((sim.quote.laborCents ?? 0) * 1.06), origin: 'copied_from_quote', originRef: null, note: 'Budget after the kickoff walk through' });
    }
    // The job was made a few days before it started, and went live on its first day.
    const made = spec.status === 'planned' ? addDays(today, -6) : addDays(startDate, -4);
    await db.execute(sql`UPDATE pulse.jobs SET created_at = ${`${made} 14:20:00+00`}::timestamptz, activated_at = CASE WHEN activated_at IS NULL THEN NULL ELSE ${`${startDate} 12:05:00+00`}::timestamptz END,
                                wms_shortage = ${Boolean(spec.wmsShortage && order)} WHERE id = ${created.id}`);
    for (const row of sim.rows) row.jobId = created.id;
    sims.push({ ...sim, jobId: created.id });
  }
  log(`${sims.length} jobs created`);

  /* 3. Production, in two parts */
  const allRows = sims.flatMap((sim) => sim.rows);
  const strip = (row: ProductionInput & { i: number }): ProductionInput => {
    const rest: ProductionInput & { i?: number } = { ...row };
    delete rest.i;
    return rest;
  };
  const finishJobs = async (when: (sim: Sim) => boolean): Promise<void> => {
    for (const sim of sims.filter(when)) {
      if (sim.spec.status === 'completed') await setJobStatus(ctx, sim.jobId, 'completed', { completedDate: dayAt(sim.last) });
      else if (sim.spec.status === 'on_hold' || sim.spec.status === 'cancelled') await setJobStatus(ctx, sim.jobId, sim.spec.status);
    }
  };
  const held = new Set(sims.filter((sim) => sim.spec.holdBack).map((sim) => sim.jobId));
  const late = (row: ProductionInput & { i: number }): boolean => held.has(row.jobId) && row.i > cut;
  await saveProductionBulk(ctx, allRows.filter((row) => !late(row)).map(strip));
  await finishJobs(() => true);
  log(`${allRows.length} production entries worked out, ${allRows.filter((row) => !late(row)).length} saved in the first part`);

  /* 4. The other streams */
  let usageRows = 0;
  let serviceRows = 0;
  let costRows = 0;
  let revenueRows = 0;
  for (const sim of sims) {
    const { spec } = sim;
    const r = rng(`${plan.seed}:${spec.n}:streams`);
    /** Extra service revenue by day, so invoices bill it with the units. */
    const serviceCents = new Map<string, number>();
    const n = Math.max(1, sim.last - sim.first + 1);
    // Parts used (jobs that track real parts).
    for (const day of spec.items ? sim.days : []) {
      for (const line of spec.items!) {
        const item = itemSpec.get(line.sku)!;
        const jumped = line.jump && day.j / n >= line.jump.at;
        const used = day.units * line.per;
        const scrapped = day.scrap * line.per + used * (line.waste ?? 0.004) * between(r, 0.4, 1.8) * (jumped ? 2.2 : 1);
        await saveMaterialUsage(ctx, {
          jobId: sim.jobId,
          usageDate: day.date,
          itemSku: line.sku,
          itemName: item.name,
          quantityUsed: q(used),
          quantityScrapped: q(scrapped),
          unitCost: (Number(item.cost) * (jumped ? line.jump!.x : 1)).toFixed(4),
          uom: item.uom ?? 'each',
          lot: spec.matSource === 'wms' ? `LOT-${(hash(`${line.sku}${Math.floor(day.j / 5)}`) % 9000) + 1000}` : null,
          suppliedBy: item.by ?? null,
          note: jumped && day.j / n < line.jump!.at + 1.5 / n ? 'Supplier price went up on this lot' : null,
          source: spec.matSource === 'wms' && hasWms ? 'wms' : 'manual',
          sourceRef: spec.matSource === 'wms' && hasWms ? `pick:${spec.n}:${day.date}:${line.sku}` : null,
        });
        usageRows += 1;
      }
    }
    // Extra services done on the job.
    for (const line of spec.vas ?? []) {
      const service = plan.services.find((item) => item.code === line.svc)!;
      for (const day of sim.days) {
        if (day.j % (line.every ?? 3) !== 0) continue;
        const quantity = Math.max(1, Math.round(day.units * line.share));
        const hours = Math.max(0.25, (quantity / service.uph) * between(r, 0.92, 1.1));
        serviceCents.set(day.date, (serviceCents.get(day.date) ?? 0) + Math.round(quantity * Number(line.price ?? service.price) * 100));
        await saveVasEntry(ctx, { vasServiceId: serviceIds.get(line.svc)!, jobId: sim.jobId, workDate: day.date, quantity: q(quantity), unitPrice: line.price, laborClassId: classIds.get(service.cls ?? defaultClass.code), headcount: String(Math.max(1, Math.ceil(hours / 7.5))), hours: h2(hours) });
        serviceRows += 1;
      }
    }
    // Other job costs.
    for (const cost of sim.days.length > 0 ? (spec.other ?? []) : []) {
      const day = sim.days[Math.min(sim.days.length - 1, Math.floor(cost.at * sim.days.length))]!;
      await saveCost(ctx, { jobId: sim.jobId, costDate: day.date, category: cost.cat, amountCents: cost.cents, vendor: cost.vendor ?? null, note: cost.note ?? null, reference: cost.vendor ? `${cost.vendor.slice(0, 3).toUpperCase()}-${(hash(spec.n + cost.cat) % 90000) + 10000}` : null });
      costRows += 1;
    }
    // A price change part way through.
    if (spec.priceChange && sim.days.length > 0) {
      const day = sim.days[Math.min(sim.days.length - 1, Math.floor(spec.priceChange.at * sim.days.length))]!;
      await setJobPrice(ctx, sim.jobId, { effectiveFrom: day.date, unitPrice: (nicePrice(sim.price * (1 + spec.priceChange.pct / 100))).toFixed(4), note: spec.priceChange.note });
    }
    // Invoices (memos: what was billed, never profit), fees and credits.
    const pricing = spec.pricing ?? 'per_unit';
    const earned = (units: number, hours: number): number =>
      pricing === 'hourly' ? Math.round(hours * sim.price * 100) : pricing === 'fixed' ? Math.round(sim.revenueCents * Math.min(1, units / Math.max(1, sim.planned))) : Math.round(units * sim.price * 100);
    if (sim.days.length > 0) {
      const cuts: number[] = [];
      for (let index = 9; index < sim.days.length - 2; index += 10) cuts.push(index);
      if (spec.status === 'completed' && !spec.unbilled) cuts.push(sim.days.length - 1);
      let billedUnits = 0;
      let billedHours = 0;
      let billedTo = '';
      for (const [index, at] of cuts.entries()) {
        const slice = sim.days.slice(0, at + 1);
        const units = slice.reduce((sum, day) => sum + day.units, 0);
        const hours = slice.reduce((sum, day) => sum + day.hours, 0);
        const services = slice.filter((day) => day.date > billedTo).reduce((sum, day) => sum + (serviceCents.get(day.date) ?? 0), 0);
        const amount = earned(units, hours) - earned(billedUnits, billedHours) + services;
        const date = addDays(sim.days[at]!.date, 2) > today ? today : addDays(sim.days[at]!.date, 2);
        if (amount > 0) {
          await saveRevenue(ctx, { jobId: sim.jobId, revenueDate: date, kind: 'invoice', description: `${spec.name}, ${(units - billedUnits).toLocaleString('en-US')} ${typeSpec.get(spec.type)!.unit}`, amountCents: amount, invoiceNumber: `INV-${(hash(`${plan.seed}${spec.n}`) % 800) + 2100 + index}` });
          revenueRows += 1;
        }
        billedUnits = units;
        billedHours = hours;
        billedTo = sim.days[at]!.date;
      }
      for (const fee of spec.fees ?? []) {
        const day = sim.days[Math.min(sim.days.length - 1, Math.floor(fee.at * sim.days.length))]!;
        await saveRevenue(ctx, { jobId: sim.jobId, revenueDate: day.date, kind: fee.kind, description: fee.desc, amountCents: fee.cents });
        revenueRows += 1;
      }
    }
  }
  // Client level rows: cost to serve that belongs to no single job.
  for (const cost of plan.clientCosts) {
    await saveCost(ctx, { clientId: clientIds.get(cost.client)!, costDate: dayAt(Math.max(firstIndex, cost.at)), category: cost.cat, amountCents: cost.cents, vendor: cost.vendor ?? null, note: cost.note });
    costRows += 1;
  }
  for (const line of plan.clientVas) {
    const service = plan.services.find((item) => item.code === line.svc)!;
    const r = rng(`${plan.seed}:${line.client}:${line.svc}`);
    for (const day of days) {
      if ((day.i - firstIndex) % line.every !== 1 || closed.has(day.i)) continue;
      const quantity = Math.round(line.qty * between(r, 0.7, 1.3));
      const hours = Math.max(0.25, (quantity / service.uph) * between(r, 0.92, 1.1));
      await saveVasEntry(ctx, { vasServiceId: serviceIds.get(line.svc)!, clientId: clientIds.get(line.client)!, siteId: mainSiteId, workDate: day.date, quantity: q(quantity), unitPrice: line.price, laborClassId: classIds.get(service.cls ?? defaultClass.code), headcount: '1', hours: h2(hours) });
      serviceRows += 1;
    }
  }
  for (const fee of plan.clientFees) {
    for (const day of days) {
      if ((day.i - firstIndex) % fee.every !== fee.every - 1) continue;
      await saveRevenue(ctx, { clientId: clientIds.get(fee.client)!, revenueDate: day.date, kind: fee.kind, description: fee.desc, amountCents: fee.cents });
      revenueRows += 1;
    }
  }
  // Company costs: one row per month and kind, the first month by its share of work days.
  for (const month of months) {
    const inMonth = days.filter((day) => startOfMonth(day.date) === month);
    let all = 0;
    for (let date = month; date <= endOfMonth(month); date = addDays(date, 1)) if (isWorkDay(date)) all += 1;
    const share = month === startOfMonth(today) ? 1 : Math.min(1, inMonth.length / Math.max(1, all));
    for (const cost of plan.companyCosts) {
      await saveCost(ctx, { costDate: inMonth[0]!.date, category: cost.cat, amountCents: Math.round((cost.cents * share) / 100) * 100, vendor: cost.vendor, note: cost.note ?? null, siteId: mainSiteId });
      costRows += 1;
    }
  }
  log(`${usageRows} parts rows, ${serviceRows} service entries, ${costRows} costs, ${revenueRows} revenue rows`);

  /* The first look at alerts sees the slow start of the held back jobs and the days with no hours. */
  await recomputeJobs(db, ctx, sims.map((sim) => sim.jobId));
  const firstPass = await evaluateAlerts(ctx);
  await saveProductionBulk(ctx, allRows.filter(late).map(strip));
  log(`${firstPass.created} alerts raised by the first part, then the held back days went in`);

  // Corrections: missing hours added later, a few recounts, and one row deleted by mistake and put back.
  let corrections = 0;
  for (const sim of sims.filter((item) => item.spec.fixNoHours)) {
    const found = await listProduction(ctx, { jobId: sim.jobId, needsHours: true, limit: 50 });
    for (const entry of found) {
      await saveProductionEntry(ctx, { id: entry.id, jobId: sim.jobId, workDate: entry.workDate, headcount: String(sim.spec.crew), hours: h2(sim.spec.crew * (sim.spec.hrs ?? 7.5)), hoursConfirmed: true, note: 'Hours added from the paper sign in sheet', version: entry.version });
      corrections += 1;
    }
  }
  const recountNotes = ['Recount: two cartons were logged twice', 'Fixed a typo in the unit count', 'Counted again after the pallet audit', 'Moved 1 hour to the right job'];
  for (const [index, sim] of sims.filter((item) => item.days.length >= 6 && item.spec.status !== 'cancelled').entries()) {
    if (index % 5 !== 2) continue;
    const day = sim.days[Math.floor(sim.days.length / 2)]!;
    if (startOfMonth(day.date) < startOfMonth(addDays(startOfMonth(today), -1))) continue;
    const [entry] = (await listProduction(ctx, { jobId: sim.jobId, from: day.date, to: day.date, limit: 5 })).filter((row) => Number(row.unitsGood) > 0);
    if (!entry) continue;
    const change = Math.max(2, Math.round(Number(entry.unitsGood) * 0.03));
    await saveProductionEntry(ctx, { id: entry.id, jobId: sim.jobId, workDate: entry.workDate, unitsGood: q(Number(entry.unitsGood) - change), note: recountNotes[corrections % recountNotes.length]!, version: entry.version });
    corrections += 1;
    if (corrections === 3) {
      await deleteProductionEntries(ctx, [entry.id]);
      await restoreProductionEntries(ctx, [entry.id]);
    }
  }

  // Time not on a job, then paid hours a little above what was logged.
  const directByDay = new Map<string, number>();
  for (const sim of sims) for (const day of sim.days) directByDay.set(day.date, (directByDay.get(day.date) ?? 0) + day.hours);
  let indirectRows = 0;
  const rDay = rng(`${plan.seed}:days`);
  for (const [date, direct] of [...directByDay].sort()) {
    if (weekday(date) === 6) continue;
    const training = months.indexOf(startOfMonth(date)) === 1 ? 1.45 : 1;
    const picks = plan.indirect.filter((_, index) => index === 0 || (hash(date + index) % 3 === 0 && indirectRows % 1 === 0)).slice(0, 3);
    for (const [index, line] of picks.entries()) {
      const hours = Math.max(0.5, direct * 0.09 * line.share * training * between(rDay, 0.75, 1.3));
      await saveIndirectEntry(ctx, { siteId: mainSiteId, workDate: date, laborClassId: classIds.get(defaultClass.code), reason: weekday(date) === 1 && index === 0 ? 'meeting' : line.reason, headcount: String(Math.max(1, Math.round(hours / 1.5))), hours: h2(hours), note: line.note ?? null });
      indirectRows += 1;
    }
  }
  const logged = await rows<{ site_id: string; day: string; hours: string; pay: string }>(db, sql`SELECT site_id, to_char(work_date, 'YYYY-MM-DD') AS day, (direct_hours + indirect_hours)::text AS hours, gross_pay_cents::text AS pay FROM pulse.company_days WHERE org_id = ${ctx.orgId} ORDER BY work_date`);
  for (const row of logged) {
    if (!(Number(row.hours) > 0)) continue;
    const extra = between(rDay, 1.025, 1.055);
    await savePaidHours(ctx, { siteId: row.site_id, workDate: row.day, paidHours: h2(Number(row.hours) * extra), paidCents: row.day >= addDays(today, -60) ? Math.round(Number(row.pay) * extra) : null, source: 'csv' });
  }
  log(`${indirectRows} rows of time not on a job, ${logged.length} days of paid hours`);

  /* 5. Goals, rules, views, notes */
  for (const goal of plan.goals) {
    const scopeId = goal.scope === 'org' ? null : goal.scope === 'client' ? clientIds.get(goal.ref!) : goal.scope === 'job_type' ? typeIds.get(goal.ref!) : goal.scope === 'vas_service' ? serviceIds.get(goal.ref!) : siteIds.get(goal.ref!);
    if (goal.scope !== 'org' && !scopeId) continue;
    for (const month of goal.monthly ? [months[months.length - 2] ?? months[0]!, months[months.length - 1]!] : [null]) await saveTarget(ctx, { scope: goal.scope, scopeId, metric: goal.metric, value: goal.value, periodMonth: month });
  }
  await createAlertRule(ctx, { name: 'Tell me when a client earns under 10% in the last 30 days', kind: 'client_margin_below', threshold: '10', severity: 'warning', notifyRoles: ['owner', 'admin'] });
  await createAlertRule(ctx, { name: 'Tell me when an extra service earns under 15%', kind: 'vas_margin_below', threshold: '15', severity: 'warning', notifyRoles: ['owner', 'admin', 'manager'] });
  for (const [index, view] of plan.views.entries()) await saveView(ctx, { page: view.page, name: view.name, config: view.config, shared: view.shared ?? true, isDefault: view.isDefault ?? false, position: index });
  let notes = 0;
  for (const sim of sims) {
    for (const note of sim.spec.notes ?? []) {
      await addNote(ctx, { jobId: sim.jobId, body: note.body });
      notes += 1;
    }
  }
  for (const note of plan.clientNotes) {
    await addNote(ctx, { clientId: clientIds.get(note.client)!, body: note.body });
    notes += 1;
  }
  for (const sim of sims.filter((item) => item.spec.expect === 'losing' || item.spec.expect === 'at_risk').slice(0, 5)) await recordRecentJob(ctx, sim.jobId);
  // Statuses read the warehouse shortage flag set after the job was made.
  const shortage = sims.filter((sim) => sim.spec.wmsShortage).map((sim) => sim.jobId);
  if (shortage.length > 0) await recomputeJobs(db, ctx, shortage);

  /* 6. Day reviews, then close the old months */
  const lastMonth = startOfMonth(addDays(startOfMonth(today), -1));
  const reviewDays = await rows<{ site_id: string; day: string }>(db, sql`SELECT DISTINCT site_id, to_char(work_date, 'YYYY-MM-DD') AS day FROM pulse.production_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL ORDER BY 2`);
  let reviews = 0;
  for (const row of reviewDays) {
    if (row.day >= dayAt(-1)) {
      if (row.day === dayAt(-1)) await markDayComplete(ctx, { siteId: row.site_id, date: row.day });
      continue;
    }
    if (row.day === dayAt(-6) && row.site_id === mainSiteId) {
      await markDayComplete(ctx, { siteId: row.site_id, date: row.day });
      await reviewDay(ctx, { siteId: row.site_id, date: row.day, decision: 'send_back', note: 'Two jobs show units and no hours. Please add the hours from the sign in sheet.' });
    }
    await reviewDay(ctx, { siteId: row.site_id, date: row.day, decision: 'approve' });
    reviews += 1;
  }
  const closedMonths: string[] = [];
  for (const month of months.filter((item) => item < lastMonth)) {
    await closePeriod(ctx, month);
    closedMonths.push(month);
  }
  log(`${reviews} days approved, ${closedMonths.length} months closed`);

  /* 6b. Time not on a job in every plan. Plans were saved before any work existed, so the automatic
     fill worked out to zero. Fill it now from the same 90 day figures a quote saved by hand uses. */
  const [recent] = await rows<{ shared: string; labor: string }>(
    db,
    sql`SELECT COALESCE(sum(amount_cents) FILTER (WHERE kind = 'shared'), 0)::text AS shared, COALESCE(sum(amount_cents) FILTER (WHERE kind = 'labor'), 0)::text AS labor
          FROM pulse.fact_days WHERE org_id = ${ctx.orgId} AND work_date > CURRENT_DATE - 90`,
  );
  const autoPlans = await rows<{ id: string; labor_cents: string }>(db, sql`SELECT id::text, labor_cents::text FROM pulse.job_plans WHERE org_id = ${ctx.orgId} AND shared_auto`);
  for (const row of autoPlans) {
    const shared = planSharedAuto({ rule: 'by_labor_hours', laborCents: BigInt(row.labor_cents), shared90Cents: BigInt(recent?.shared ?? 0), labor90Cents: BigInt(recent?.labor ?? 0) });
    await db.execute(sql`UPDATE pulse.job_plans SET shared_cents = ${shared.toString()}::bigint WHERE id = ${row.id}::uuid AND org_id = ${ctx.orgId}`);
  }

  /* 7. Alerts and the inbox */
  await recomputeJobs(db, ctx, sims.map((sim) => sim.jobId));
  const secondPass = await evaluateAlerts(ctx);
  const open = await listAlerts(ctx, { status: 'open', limit: 200 });
  const manager = plan.roles.find((role) => role.role === 'manager');
  const supervisor = plan.roles.find((role) => role.role === 'supervisor');
  const jobAlerts = open.filter((alert) => alert.entityType === 'job');
  if (jobAlerts[0] && userId(manager?.email)) await updateAlert(ctx, jobAlerts[0].id, { action: 'assign', userId: userId(manager?.email) });
  if (jobAlerts[1] && userId(supervisor?.email)) await updateAlert(ctx, jobAlerts[1].id, { action: 'assign', userId: userId(supervisor?.email) });
  const info = open.filter((alert) => alert.severity === 'info');
  if (info[0]) await updateAlert(ctx, info[0].id, { action: 'snooze', until: addDays(today, 5) });
  const noEntry = open.find((alert) => alert.kind === 'no_entry_days');
  if (noEntry) await updateAlert(ctx, noEntry.id, { action: 'snooze', until: addDays(today, 2) });
  const overhead = open.find((alert) => alert.kind === 'overhead_rate_off');
  if (overhead && overhead.id !== info[0]?.id) await updateAlert(ctx, overhead.id, { action: 'dismiss' });
  const unread = await listNotifications(ctx, { limit: 200 });
  const older = unread.filter((_, index) => index % 3 !== 0).map((item) => item.id);
  if (older.length > 0) await markNotificationsRead(ctx, older);

  /* 8. Move timestamps back so the history reads like 90 real days */
  await backdate(ctx.orgId, today, dayAt(cut), ctx.userId, [userId(manager?.email), userId(supervisor?.email)].filter((id): id is string => Boolean(id)));

  return summarize(ctx, plan, sims, { started, closedMonths, alertsRaised: firstPass.created + secondPass.created, corrections, notes, reviews });
}

/**
 * Seed housekeeping: rows written a moment ago get the timestamp of the day they are about.
 * The activity log is append only, so its rows are copied out, removed and put back with the
 * new time (DELETE is allowed for seeds; UPDATE never is).
 */
async function backdate(orgId: string, today: string, cutDay: string, actorId: string, others: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL pulse.allow_purge = 'on'`);
    const stamp = (dateColumn: string) => sql.raw(`LEAST(now() - interval '20 minutes', (${dateColumn})::timestamp + interval '15 hours' + (abs(hashtext(id::text)) % 240) * interval '1 minute')`);
    for (const [table, column] of [
      ['production_entries', 'work_date'],
      ['indirect_entries', 'work_date'],
      ['paid_hours', 'work_date'],
      ['material_usage', 'usage_date'],
      ['cost_entries', 'cost_date'],
      ['revenue_entries', 'revenue_date'],
      ['vas_entries', 'work_date'],
    ] as const) {
      await tx.execute(sql`UPDATE pulse.${sql.raw(table)} SET created_at = ${stamp(column)}, updated_at = GREATEST(${stamp(column)}, CASE WHEN version > 1 THEN ${stamp(column)} + interval '1 day' ELSE ${stamp(column)} END) WHERE org_id = ${orgId}`);
    }
    await tx.execute(sql`UPDATE pulse.day_reviews SET marked_at = LEAST(now(), work_date::timestamp + interval '22 hours'), reviewed_at = CASE WHEN reviewed_at IS NULL THEN NULL ELSE LEAST(now(), work_date::timestamp + interval '38 hours') END,
                                created_at = LEAST(now(), work_date::timestamp + interval '22 hours') WHERE org_id = ${orgId}`);
    await tx.execute(sql`UPDATE pulse.periods SET closed_at = (period_month + interval '1 month' + interval '6 days 15 hours') WHERE org_id = ${orgId} AND status = 'closed'`);
    // Alerts: the ones raised by the first part of the history are older; cleared ones were open for a few days.
    await tx.execute(sql`UPDATE pulse.alerts a SET first_seen_at = t.seen, created_at = t.seen,
                                resolved_at = CASE WHEN a.resolved_at IS NULL THEN NULL ELSE LEAST(now() - interval '3 hours', t.seen + interval '4 days') END
                           FROM (SELECT id, CASE WHEN resolved_at IS NOT NULL AND resolution = 'cleared' THEN ${cutDay}::timestamp + interval '21 hours'
                                                 ELSE now() - ((abs(hashtext(id::text)) % 9) + 1) * interval '19 hours' END AS seen
                                   FROM pulse.alerts WHERE org_id = ${orgId}) t
                          WHERE a.id = t.id`);
    await tx.execute(sql`UPDATE pulse.notifications n SET created_at = COALESCE((SELECT a.first_seen_at + interval '1 minute' FROM pulse.alerts a WHERE a.id = n.alert_id), n.created_at),
                                read_at = CASE WHEN n.read_at IS NULL THEN NULL ELSE now() - interval '2 hours' END WHERE n.org_id = ${orgId}`);
    // Activity: copy, clear, put back with the day each row is about. A few rows go to other people.
    await tx.execute(sql`CREATE TEMP TABLE seed_activity ON COMMIT DROP AS SELECT * FROM pulse.activity WHERE org_id = ${orgId}`);
    await tx.execute(sql`DELETE FROM pulse.activity WHERE org_id = ${orgId}`);
    const pool = sql.raw(others.length > 0 ? `ARRAY[${others.map((id) => `'${id.replace(/[^0-9a-f-]/gi, '')}'`).join(', ')}]::uuid[]` : `ARRAY[]::uuid[]`);
    await tx.execute(sql`
      INSERT INTO pulse.activity (id, org_id, actor_id, actor_kind, verb, entity_type, entity_id, job_id, client_id, field, before, after, meta, body, created_at)
      SELECT a.id, a.org_id,
             CASE WHEN a.actor_kind = 'user' AND a.actor_id = ${actorId} AND cardinality(${pool}) > 0 AND a.entity_type IN ('production', 'indirect', 'material', 'service_entry', 'day', 'paid_hours')
                  THEN (${pool})[1 + abs(hashtext(COALESCE(a.meta->>'workDate', a.job_id::text, a.id::text))) % cardinality(${pool})] ELSE a.actor_id END,
             a.actor_kind, a.verb, a.entity_type, a.entity_id, a.job_id, a.client_id, a.field, a.before, a.after, a.meta, a.body,
             LEAST(a.created_at, COALESCE(
               (SELECT p.created_at + CASE WHEN a.verb = 'production.logged' THEN interval '0' ELSE interval '1 day' END FROM pulse.production_entries p WHERE p.id = a.entity_id),
               (SELECT p.created_at FROM pulse.indirect_entries p WHERE p.id = a.entity_id),
               (SELECT p.created_at FROM pulse.material_usage p WHERE p.id = a.entity_id),
               (SELECT p.created_at FROM pulse.cost_entries p WHERE p.id = a.entity_id),
               (SELECT p.created_at FROM pulse.revenue_entries p WHERE p.id = a.entity_id),
               (SELECT p.created_at FROM pulse.vas_entries p WHERE p.id = a.entity_id),
               (SELECT p.created_at FROM pulse.paid_hours p WHERE p.id = a.entity_id),
               (SELECT p.closed_at FROM pulse.periods p WHERE p.id = a.entity_id AND a.verb = 'period.closed'),
               CASE WHEN a.meta ? 'workDate' THEN (a.meta->>'workDate')::timestamp + CASE WHEN a.verb = 'day.approved' THEN interval '38 hours' ELSE interval '22 hours' END END,
               (SELECT CASE WHEN a.verb IN ('job.created', 'plan.saved', 'link.added') OR a.verb LIKE 'plan%' THEN j.created_at + interval '5 minutes'
                            WHEN a.verb LIKE 'job.status%' AND j.completed_date IS NOT NULL THEN j.completed_date::timestamp + interval '21 hours'
                            WHEN a.verb LIKE 'note%' THEN GREATEST(j.created_at, now() - ((abs(hashtext(a.id::text)) % 12) + 1) * interval '26 hours')
                            ELSE GREATEST(j.created_at + interval '1 day', now() - ((abs(hashtext(a.id::text)) % 20) + 1) * interval '23 hours') END
                  FROM pulse.jobs j WHERE j.id = a.job_id),
               CASE WHEN a.entity_type = 'alert' OR a.verb LIKE 'note%' OR a.verb LIKE 'alert.%' THEN now() - ((abs(hashtext(a.id::text)) % 6) + 1) * interval '7 hours' END,
               ${today}::timestamp - interval '96 days' + (abs(hashtext(a.id::text)) % 600) * interval '1 minute'))
        FROM seed_activity a`);
  });
}

async function summarize(
  ctx: DomainContext,
  plan: OrgPlan,
  sims: Sim[],
  extra: { started: number; closedMonths: string[]; alertsRaised: number; corrections: number; notes: number; reviews: number },
): Promise<RichSummary> {
  const tables = ['clients', 'job_types', 'labor_classes', 'labor_rates', 'vas_services', 'items', 'standards', 'targets', 'jobs', 'job_plans', 'job_links', 'job_prices', 'production_entries', 'indirect_entries', 'paid_hours', 'material_usage', 'cost_entries', 'revenue_entries', 'vas_entries', 'day_reviews', 'periods', 'alert_rules', 'alerts', 'notifications', 'saved_views', 'activity', 'fact_days', 'member_roles'];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const [row] = await rows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM pulse.${sql.raw(table)} WHERE org_id = ${ctx.orgId}`);
    counts[table] = row?.n ?? 0;
  }
  const jobs = await listJobs(ctx, { tab: 'all', limit: 500 });
  const statuses: Record<string, number> = {};
  for (const job of jobs) {
    const key = job.status === 'active' ? `active: ${job.stats.riskStatus ?? 'none'}` : job.status === 'completed' ? `completed: ${(job.stats.profitCents ?? 0) < 0 ? 'lost money' : 'made money'}` : job.status;
    statuses[key] = (statuses[key] ?? 0) + 1;
  }
  const pct = (bp: number | null | undefined): string => (bp === null || bp === undefined ? 'n/a' : `${(bp / 100).toFixed(1)}%`);
  const story = sims
    .filter((sim) => sim.spec.expect)
    .map((sim) => {
      const job = jobs.find((item) => item.id === sim.jobId);
      const status = job?.stats.riskStatus ?? 'none';
      return { number: sim.spec.n, name: sim.spec.name, status, expect: sim.spec.expect!, ok: status === sim.spec.expect, margin: pct(job?.status === 'completed' ? job?.stats.marginBp : (job?.stats.projectedMarginBp ?? job?.stats.marginBp)), headline: job?.stats.headline ?? '' };
    });
  const money = (kindSql: string, group: string, join = '') =>
    rows<{ label: string; revenue: string; profit: string }>(
      db,
      sql`SELECT ${sql.raw(group)} AS label, sum(CASE WHEN f.kind LIKE 'revenue%' THEN f.amount_cents ELSE 0 END)::text AS revenue,
                 sum(CASE WHEN f.kind LIKE 'revenue%' THEN f.amount_cents WHEN f.kind = 'billed_memo' THEN 0 ELSE -f.amount_cents END)::text AS profit
            FROM pulse.fact_days f ${sql.raw(join)} WHERE f.org_id = ${ctx.orgId} ${sql.raw(kindSql)} GROUP BY 1 ORDER BY 1`,
    );
  const line = (row: { label: string; revenue: string; profit: string }) => ({ revenue: Math.round(Number(row.revenue) / 100), profit: Math.round(Number(row.profit) / 100), marginPct: Number(row.revenue) > 0 ? `${((Number(row.profit) / Number(row.revenue)) * 100).toFixed(1)}%` : 'n/a' });
  const byMonth = await money('', `to_char(date_trunc('month', f.work_date), 'YYYY-MM-DD')`);
  const byClient = await money('', 'c.name', 'JOIN pulse.clients c ON c.id = f.client_id');
  const byService = await money('AND f.vas_service_id IS NOT NULL', 's.name', 'JOIN pulse.vas_services s ON s.id = f.vas_service_id');
  const [check] = await rows<{ facts: string; days: string; kinds: number }>(
    db,
    sql`SELECT (SELECT COALESCE(sum(amount_cents), 0) FROM pulse.v_facts WHERE org_id = ${ctx.orgId})::text AS facts,
               (SELECT COALESCE(sum(amount_cents), 0) FROM pulse.fact_days WHERE org_id = ${ctx.orgId})::text AS days,
               (SELECT count(*) FROM (SELECT kind, sum(amount_cents) s FROM pulse.v_facts WHERE org_id = ${ctx.orgId} GROUP BY 1
                                       EXCEPT SELECT kind, sum(amount_cents) FROM pulse.fact_days WHERE org_id = ${ctx.orgId} GROUP BY 1) d)::int AS kinds`,
  );
  const alertRows = await rows<{ status: string; n: number }>(db, sql`SELECT status, count(*)::int AS n FROM pulse.alerts WHERE org_id = ${ctx.orgId} GROUP BY 1`);
  return {
    org: ctx.orgSlug,
    counts: { ...counts, corrections: extra.corrections, notes: extra.notes },
    statuses,
    story,
    months: byMonth.map((row) => ({ month: row.label.slice(0, 7), ...line(row), closed: extra.closedMonths.includes(row.label) })),
    clients: byClient.map((row) => ({ name: row.label, ...line(row) })).sort((a, b) => b.revenue - a.revenue),
    services: byService.map((row) => ({ name: row.label, ...line(row) })).sort((a, b) => b.revenue - a.revenue),
    reconciled: check?.facts === check?.days && check?.kinds === 0,
    alerts: Object.fromEntries(alertRows.map((row) => [row.status, row.n])),
    ms: Date.now() - extra.started,
  };
}

/** Prints the summary as plain tables. */
export function printSummary(summary: RichSummary): void {
  const out = (text: string): void => void process.stdout.write(`${text}\n`);
  const table = (title: string, head: string[], body: (string | number)[][]): void => {
    const all = [head, ...body.map((row) => row.map(String))];
    const widths = head.map((_, column) => Math.max(...all.map((row) => (row[column] ?? '').length)));
    out(`\n${title}`);
    all.forEach((row, index) => {
      out(`  ${row.map((cell, column) => cell.padEnd(widths[column]!)).join('  ')}`);
      if (index === 0) out(`  ${widths.map((width) => '-'.repeat(width)).join('  ')}`);
    });
  };
  const usd = (value: number): string => `$${value.toLocaleString('en-US')}`;
  out(`\n================ ${summary.org}: rich demo seed (${(summary.ms / 1000).toFixed(1)} s) ================`);
  table('Rows', ['table', 'rows'], Object.entries(summary.counts).map(([name, count]) => [name, count]));
  table('Jobs by status', ['status', 'jobs'], Object.entries(summary.statuses).sort().map(([name, count]) => [name, count]));
  table('Story jobs', ['job', 'name', 'status', 'wanted', 'ok', 'margin', 'headline'], summary.story.map((row) => [row.number, row.name.slice(0, 38), row.status, row.expect, row.ok ? 'yes' : 'NO', row.margin, row.headline.slice(0, 90)]));
  table('Company by month (before company costs)', ['month', 'revenue', 'profit', 'margin', 'closed'], summary.months.map((row) => [row.month, usd(row.revenue), usd(row.profit), row.marginPct, row.closed ? 'closed' : 'open']));
  table('Clients, cost to serve counted', ['client', 'revenue', 'profit', 'margin'], summary.clients.map((row) => [row.name, usd(row.revenue), usd(row.profit), row.marginPct]));
  table('Extra services', ['service', 'revenue', 'profit', 'margin'], summary.services.map((row) => [row.name, usd(row.revenue), usd(row.profit), row.marginPct]));
  table('Alerts', ['status', 'alerts'], Object.entries(summary.alerts).map(([name, count]) => [name, count]));
  out(`\n  Reconciliation: sum of v_facts ${summary.reconciled ? 'equals' : 'DOES NOT equal'} fact_days, kind by kind.`);
  const wrong = summary.story.filter((row) => !row.ok);
  out(wrong.length === 0 ? '  Story check: every story job shows the status the demo needs.' : `  Story check: ${wrong.length} job(s) do not show the wanted status: ${wrong.map((row) => row.number).join(', ')}.`);
}
