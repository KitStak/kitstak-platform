/**
 * Programs for CRM and WMS (docs/programs/SPEC.md 6.2, 6.3): which KitStak Projects programs
 * serve a CRM deal, account or shared customer, with this month's units and money, and which
 * programs build a WMS kit. Money comes from the shared program money reader (output snapshots
 * plus the ledger, `month-stats.ts`), so every panel shows the cents Projects shows. Money is
 * hidden by the Projects rule (A10, `canSeeProgramMoney`).
 *
 * Like every bridge read nothing here throws: an older database (no `pm.projects.kind`, no
 * program tables) or a failed read answers `{ available: false, reason }`.
 */
import { sql, type SQL } from 'drizzle-orm';
import { dealFacts, type CrmDealFacts } from '@kitstak/db/crm-deal-facts';
import { safeTimezone } from '@kitstak/db/programs';
import { addDays, monthOf, shiftMonth, startOfWeek } from '@kitstak/programs-engine/calendar';
import { fromScaled, quantityToScaled, ZERO, type Cents } from '@kitstak/programs-engine/money';
import { cardSummary, versionFor } from '@kitstak/programs-engine/price';
import { todayIn } from '@kitstak/programs-engine/schedule';
import type { IsoDate, IsoMonth } from '@kitstak/programs-engine/types';
import { orgRoleOf, visibleProjects } from './access';
import { isUuid, list, pmAvailability, query, type BridgeExecutor } from './executor';
import { programMonthStats, storedMonthsCents } from './month-stats';
import { canSeeProgramMoney, isProjectRole, type OrgRole, type ProjectRole } from './permissions';
import { projectsBase } from './read';
import type { BridgeActor, BridgeTarget, BridgeUrls } from './types';

export type ProgramsUnavailableReason = 'not_installed' | 'no_access';
export interface ProgramsUnavailable {
  readonly available: false;
  readonly reason: ProgramsUnavailableReason;
}

export type BridgeProgramStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'archived';

/** Program words for the shared project statuses (same as Projects `PROGRAM_STATUS_LABELS`). */
export const BRIDGE_PROGRAM_STATUS_LABELS: Readonly<Record<BridgeProgramStatus, string>> = {
  planning: 'Setting up',
  active: 'Running',
  on_hold: 'Paused',
  completed: 'Ended',
  archived: 'Archived',
};

export type BridgeProgramLinkVia = 'record_link' | 'integration_link' | 'deal_pointer' | 'customer_pointer';

export interface BridgeProgram {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly status: BridgeProgramStatus;
  readonly statusLabel: string;
  readonly color: string;
  readonly icon: string;
  readonly unit: { readonly singular: string; readonly plural: string };
  readonly customerName: string | null;
  /** This person may not see money on this program: every cents field is null. */
  readonly moneyHidden: boolean;
  readonly month: {
    readonly month: IsoMonth;
    /** Units built this month, 3 decimals. */
    readonly units: string;
    readonly revenueCents: string | null;
    readonly forecastCents: string | null;
    readonly forecastMethod: 'planned' | 'recent';
    /** Forecast over the monthly target in basis points, null with no target or hidden money. */
    readonly targetBp: number | null;
  };
  readonly today: { readonly date: IsoDate; readonly builds: number; readonly done: number };
  readonly cardSummary: string | null;
  readonly deal: {
    readonly valueCents: string;
    readonly termMonths: number | null;
    /** True when the deal has no term and `termMonths` is the engine's 12 month default. */
    readonly termIsDefault?: boolean;
    readonly onTrackForCents: string | null;
  } | null;
  readonly url: string;
  readonly linkVia: BridgeProgramLinkVia;
}

export interface LinkedPrograms {
  readonly available: true;
  /** True when money is hidden on every program listed (or, with none, for this person's role). */
  readonly moneyHidden: boolean;
  readonly programs: readonly BridgeProgram[];
}

export interface KitProgram {
  readonly key: string;
  readonly name: string;
  readonly url: string;
  readonly status: BridgeProgramStatus;
  readonly statusLabel: string;
  readonly unit: { readonly singular: string; readonly plural: string };
  readonly variant: { readonly id: string; readonly name: string; readonly sku: string | null };
  /** Planned this week (Monday to Sunday in the program time zone), not counting cancelled builds. */
  readonly plannedThisWeek: string;
  readonly builtThisMonth: string;
  /** The next open build of this variant on or after today. */
  readonly nextBuildDate: IsoDate | null;
}

export interface ProgramsForKit {
  readonly available: true;
  readonly programs: readonly KitProgram[];
}

const NOT_INSTALLED: ProgramsUnavailable = { available: false, reason: 'not_installed' };
const NO_ACCESS: ProgramsUnavailable = { available: false, reason: 'no_access' };
const MAX_PROGRAMS = 20;

/** `https://projects…/programs/GLOVE`. */
export function programUrl(urls: BridgeUrls, key: string): string {
  return `${projectsBase(urls)}/programs/${encodeURIComponent(key)}`;
}

/** The new program wizard, started from a CRM record (Step 0 is skipped, 5.4). */
export function newProgramUrl(urls: BridgeUrls, from: { readonly crmItem?: string | null; readonly name?: string | null; readonly customer?: string | null }): string {
  const params = new URLSearchParams();
  if (from.crmItem) params.set('crmItem', from.crmItem);
  if (from.name) params.set('name', from.name);
  if (from.customer) params.set('customer', from.customer);
  const query = params.toString();
  return `${projectsBase(urls)}/programs/new${query ? `?${query}` : ''}`;
}

/** Bridge targets to `core.record_links` types: a CRM deal is `crm_item` in the bridge and `crm_deal` in the link graph. */
function recordTypeOf(type: BridgeTarget['type']): 'crm_deal' | 'crm_account' | 'core_customer' | null {
  if (type === 'crm_item') return 'crm_deal';
  if (type === 'crm_account') return 'crm_account';
  if (type === 'core_customer') return 'core_customer';
  return null;
}

const PROGRAM_TARGET_TYPES = new Set<BridgeTarget['type']>(['crm_item', 'crm_account', 'core_customer']);

function cleanTargets(targets: readonly BridgeTarget[]): BridgeTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.type}:${target.id}`;
    if (!target.id || !PROGRAM_TARGET_TYPES.has(target.type) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function hasTable(db: BridgeExecutor, name: string): Promise<boolean> {
  const [row] = await query<{ ok: boolean }>(db, sql`select to_regclass(${name}) is not null as ok`);
  return row?.ok === true;
}

const VIA_RANK: Readonly<Record<BridgeProgramLinkVia, number>> = { record_link: 0, integration_link: 1, deal_pointer: 2, customer_pointer: 3 };

/** Program ids linked to the targets, with the strongest way each one is linked. */
async function linkedProgramIds(db: BridgeExecutor, orgId: string, targets: readonly BridgeTarget[]): Promise<Map<string, BridgeProgramLinkVia>> {
  const via = new Map<string, BridgeProgramLinkVia>();
  const note = (id: string, how: BridgeProgramLinkVia) => {
    if (!isUuid(id)) return;
    const current = via.get(id);
    if (!current || VIA_RANK[how] < VIA_RANK[current]) via.set(id, how);
  };
  const edges = targets.flatMap((target) => {
    const type = recordTypeOf(target.type);
    return type ? [{ type, id: target.id }] : [];
  });
  if (edges.length > 0 && (await hasTable(db, 'core.record_links'))) {
    const match = (side: 'from' | 'to') =>
      sql.join(
        edges.map((edge) => sql`(${sql.raw(`${side}_type`)} = ${edge.type} and ${sql.raw(`${side}_id`)} = ${edge.id})`),
        sql` or `,
      );
    const rows = await query<{ id: string }>(
      db,
      sql`select to_id as id from core.record_links where org_id = ${orgId}::uuid and to_type = 'pm_program' and (${match('from')})
          union
          select from_id as id from core.record_links where org_id = ${orgId}::uuid and from_type = 'pm_program' and (${match('to')})`,
    );
    for (const row of rows) note(row.id, 'record_link');
  }
  const legacy = await query<{ id: string }>(
    db,
    sql`select l.project_id::text as id from pm.integration_links l
         where l.org_id = ${orgId}::uuid and l.project_id is not null
           and (${sql.join(
             targets.map((target) => sql`(l.target_type = ${target.type} and l.target_id = ${target.id})`),
             sql` or `,
           )})`,
  );
  for (const row of legacy) note(row.id, 'integration_link');
  const crmIds = targets.filter((t) => (t.type === 'crm_item' || t.type === 'crm_account') && isUuid(t.id)).map((t) => t.id);
  const customerIds = targets.filter((t) => t.type === 'core_customer' && isUuid(t.id)).map((t) => t.id);
  if (crmIds.length > 0 || customerIds.length > 0) {
    const pointers = await query<{ id: string; deal: boolean }>(
      db,
      sql`select p.id::text as id, ${crmIds.length ? sql`p.crm_item_id::text in ${list(crmIds)}` : sql`false`} as deal
            from pm.projects p
           where p.org_id = ${orgId}::uuid and p.kind = 'program'
             and (${crmIds.length ? sql`p.crm_item_id::text in ${list(crmIds)}` : sql`false`}
               or ${customerIds.length ? sql`p.crm_customer_id::text in ${list(customerIds)}` : sql`false`})`,
    );
    for (const row of pointers) note(row.id, row.deal ? 'deal_pointer' : 'customer_pointer');
  }
  return via;
}

interface ProgramRow {
  id: string;
  key: string;
  name: string;
  status: BridgeProgramStatus;
  color: string;
  icon: string;
  visibility: string;
  owner_id: string | null;
  start_date: string | null;
  unit_singular: string | null;
  unit_plural: string | null;
  timezone: string | null;
  org_timezone: string | null;
  monthly_target_cents: string | null;
  money_min_role: string | null;
  member_role: string | null;
  core_customer_name: string | null;
  account_name: string | null;
}

async function loadPrograms(db: BridgeExecutor, actor: BridgeActor, role: OrgRole, where: SQL): Promise<ProgramRow[]> {
  const hasLinks = await hasTable(db, 'core.record_links');
  const hasCustomers = await hasTable(db, 'core.customers');
  return query<ProgramRow>(
    db,
    sql`select p.id::text as id, p.key, p.name, p.status, p.color, p.icon, p.visibility, p.owner_id::text as owner_id,
               p.start_date::text as start_date, ps.unit_singular, ps.unit_plural, ps.timezone, oc.timezone as org_timezone,
               ps.monthly_target_cents::text as monthly_target_cents, ps.money_min_role,
               (select m.role from pm.project_members m where m.project_id = p.id and m.user_id = ${actor.userId}::uuid) as member_role,
               ${hasCustomers ? sql`(select c.name from core.customers c where c.id = p.crm_customer_id and c.deleted_at is null)` : sql`null::text`} as core_customer_name,
               ${
                 hasLinks
                   ? sql`(select coalesce(l.cached_title, (select i.name from crm.items i where i.id::text = case when l.from_type = 'crm_account' then l.from_id else l.to_id end))
                            from core.record_links l
                           where l.org_id = p.org_id and l.relation = 'belongs_to'
                             and ((l.from_type = 'pm_program' and l.from_id = p.id::text and l.to_type = 'crm_account')
                               or (l.to_type = 'pm_program' and l.to_id = p.id::text and l.from_type = 'crm_account'))
                           order by l.created_at limit 1)`
                   : sql`null::text`
               } as account_name
          from pm.projects p
          left join pm.program_settings ps on ps.program_id = p.id
          left join pm.org_calendar oc on oc.org_id = p.org_id
         where p.org_id = ${actor.orgId}::uuid and p.kind = 'program' and p.is_template = false
           and ${visibleProjects(role, actor.userId)} and ${where}
         order by (p.archived_at is not null), (p.status in ('completed', 'archived')), p.name
         limit ${MAX_PROGRAMS}`,
  );
}

function moneyHiddenFor(role: OrgRole, row: ProgramRow, userId: string): boolean {
  const minimum: ProjectRole = isProjectRole(row.money_min_role) ? row.money_min_role : 'editor';
  return !canSeeProgramMoney({
    orgRole: role,
    memberRole: isProjectRole(row.member_role) ? row.member_role : null,
    isProjectOwner: row.owner_id === userId,
    moneyMinRole: minimum,
  });
}

const zone = (row: Pick<ProgramRow, 'timezone' | 'org_timezone'>) => safeTimezone(row.timezone ?? row.org_timezone);
const cents = (value: Cents, hidden: boolean): string | null => (hidden ? null : value.toString());

/**
 * The program's whole deal term (6.2): revenue of the months before this one inside the term,
 * plus this month's forecast, plus this month's forecast times the months left in the term.
 * Months count from the program's start month. Null when the deal has no term.
 */
async function onTrackFor(db: BridgeExecutor, programId: string, startDate: string | null, month: IsoMonth, forecast: Cents, termMonths: number | null): Promise<Cents | null> {
  if (!termMonths || termMonths < 1 || !startDate) return null;
  const first = monthOf(startDate);
  const last = shiftMonth(first, termMonths - 1);
  if (month > last) {
    const past = await storedMonthsCents(db, programId, first, last);
    return [...past.values()].reduce((sum, value) => sum + value, ZERO);
  }
  const before = month > first ? await storedMonthsCents(db, programId, first, shiftMonth(month, -1)) : new Map<IsoMonth, Cents>();
  const past = [...before.values()].reduce((sum, value) => sum + value, ZERO);
  let left = 0;
  for (let m = shiftMonth(month, 1); m <= last; m = shiftMonth(m, 1)) left += 1;
  const current = month < first ? ZERO : forecast;
  return past + current + current * BigInt(left);
}

/**
 * Programs linked to a CRM deal, a CRM account or a shared customer (any of `targets`), with
 * this month's units, revenue and forecast. Matches `core.record_links` edges (both ways),
 * `pm.integration_links` on the program, and the program's own `crm_item_id` and
 * `crm_customer_id`. On a deal, each program carries the deal value and the "on track for" line.
 */
export async function listLinkedPrograms(
  db: BridgeExecutor,
  actor: BridgeActor,
  targets: readonly BridgeTarget[],
  urls: BridgeUrls,
  options: { readonly month?: IsoMonth; readonly now?: Date } = {},
): Promise<LinkedPrograms | ProgramsUnavailable> {
  try {
    if (!isUuid(actor.orgId) || !isUuid(actor.userId)) return NO_ACCESS;
    if (!(await pmAvailability(db)).programs) return NOT_INSTALLED;
    const role = await orgRoleOf(db, actor);
    if (!role) return NO_ACCESS;
    const roleHidden = role !== 'owner' && role !== 'admin';
    const wanted = cleanTargets(targets);
    if (wanted.length === 0) return { available: true, moneyHidden: roleHidden, programs: [] };
    const via = await linkedProgramIds(db, actor.orgId, wanted);
    if (via.size === 0) return { available: true, moneyHidden: roleHidden, programs: [] };
    const rows = await loadPrograms(db, actor, role, sql`p.id::text in ${list([...via.keys()])}`);
    const dealTarget = wanted.find((target) => target.type === 'crm_item' && isUuid(target.id));
    let deal: CrmDealFacts | null = null;
    if (dealTarget) {
      const facts = await dealFacts(db as never, actor.orgId, dealTarget.id).catch(() => null);
      deal = facts?.boardKind === 'deal' ? facts : null;
    }
    const now = options.now ?? new Date();
    const programs: BridgeProgram[] = [];
    for (const row of rows) {
      const hidden = moneyHiddenFor(role, row, actor.userId);
      const today = todayIn(zone(row), now);
      const stats = await programMonthStats(db, actor.orgId, { id: row.id, monthlyTargetCents: row.monthly_target_cents ? BigInt(row.monthly_target_cents) : null }, today, options.month);
      const [todayRow] = await query<{ builds: number | string; done: number | string }>(
        db,
        sql`select count(*)::int as builds, count(*) filter (where s.category = 'done')::int as done
              from pm.builds b join pm.tasks t on t.id = b.task_id and t.deleted_at is null join pm.statuses s on s.id = t.status_id
             where b.org_id = ${actor.orgId}::uuid and b.container_id = ${row.id}::uuid and b.build_date = ${today}::date`,
      );
      const status = (row.status in BRIDGE_PROGRAM_STATUS_LABELS ? row.status : 'active') as BridgeProgramStatus;
      const unit = { singular: row.unit_singular ?? 'kit', plural: row.unit_plural ?? 'kits' };
      let dealBlock: BridgeProgram['deal'] = null;
      if (deal && deal.valueCents !== null && !hidden) {
        // A deal with no term column counts 12 months, the engine's rule (`monthlyFromDeal`).
        const term = deal.rates.termMonths ?? 12;
        const onTrack = await onTrackFor(db, row.id, row.start_date, stats.month, stats.forecast.forecastCents, term);
        dealBlock = {
          valueCents: deal.valueCents.toString(),
          termMonths: term,
          termIsDefault: deal.rates.termMonths == null,
          onTrackForCents: onTrack === null ? null : onTrack.toString(),
        };
      }
      programs.push({
        id: row.id,
        key: row.key,
        name: row.name,
        status,
        statusLabel: BRIDGE_PROGRAM_STATUS_LABELS[status],
        color: row.color,
        icon: row.icon,
        unit,
        customerName: row.core_customer_name ?? row.account_name ?? null,
        moneyHidden: hidden,
        month: {
          month: stats.month,
          units: stats.result.units,
          revenueCents: cents(stats.revenueCents, hidden),
          forecastCents: cents(stats.forecast.forecastCents, hidden),
          forecastMethod: stats.forecast.method,
          targetBp: hidden ? null : stats.forecast.targetBp,
        },
        today: { date: today, builds: Number(todayRow?.builds ?? 0), done: Number(todayRow?.done ?? 0) },
        cardSummary: hidden ? null : cardSummary(versionFor(stats.versions, today), unit.singular),
        deal: dealBlock,
        url: programUrl(urls, row.key),
        linkVia: via.get(row.id) ?? 'record_link',
      });
    }
    return { available: true, moneyHidden: programs.length > 0 ? programs.every((p) => p.moneyHidden) : roleHidden, programs };
  } catch (error) {
    console.warn('[pm-bridge] listLinkedPrograms failed', error);
    return NOT_INSTALLED;
  }
}

/** How many programs the actor can see linked to the targets (tab badges). Zero when Programs is not installed. */
export async function countLinkedPrograms(db: BridgeExecutor, actor: BridgeActor, targets: readonly BridgeTarget[]): Promise<number> {
  try {
    if (!isUuid(actor.orgId) || !isUuid(actor.userId)) return 0;
    if (!(await pmAvailability(db)).programs) return 0;
    const role = await orgRoleOf(db, actor);
    if (!role) return 0;
    const wanted = cleanTargets(targets);
    if (wanted.length === 0) return 0;
    const via = await linkedProgramIds(db, actor.orgId, wanted);
    if (via.size === 0) return 0;
    const [row] = await query<{ n: number | string }>(
      db,
      sql`select count(*)::int as n from pm.projects p
           where p.org_id = ${actor.orgId}::uuid and p.kind = 'program' and p.is_template = false
             and ${visibleProjects(role, actor.userId)} and p.id::text in ${list([...via.keys()])}`,
    );
    return Number(row?.n ?? 0);
  } catch (error) {
    console.warn('[pm-bridge] countLinkedPrograms failed', error);
    return 0;
  }
}

/**
 * Programs that build a kit (WMS product detail, 6.3): variants linked to the core item or the
 * WMS product, through the variant's own columns or a `uses_kit` edge. Units only, never money.
 */
export async function listProgramsForKit(
  db: BridgeExecutor,
  actor: BridgeActor,
  kit: { readonly coreItemId?: string | null; readonly wmsProductId?: string | null },
  urls: BridgeUrls,
  options: { readonly now?: Date } = {},
): Promise<ProgramsForKit | ProgramsUnavailable> {
  try {
    if (!isUuid(actor.orgId) || !isUuid(actor.userId)) return NO_ACCESS;
    if (!(await pmAvailability(db)).programs) return NOT_INSTALLED;
    const role = await orgRoleOf(db, actor);
    if (!role) return NO_ACCESS;
    const coreItemId = kit.coreItemId && isUuid(kit.coreItemId) ? kit.coreItemId : null;
    const wmsProductId = kit.wmsProductId ? String(kit.wmsProductId).slice(0, 64) : null;
    if (!coreItemId && !wmsProductId) return { available: true, programs: [] };
    const hasLinks = await hasTable(db, 'core.record_links');
    const match: SQL[] = [];
    if (coreItemId) match.push(sql`v.core_item_id = ${coreItemId}::uuid`);
    if (wmsProductId) match.push(sql`v.wms_product_id = ${wmsProductId}`);
    if (hasLinks) {
      const kits: SQL[] = [];
      if (coreItemId) kits.push(sql`(l.to_type = 'core_item' and l.to_id = ${coreItemId})`);
      if (wmsProductId) kits.push(sql`(l.to_type = 'wms_product' and l.to_id = ${wmsProductId})`);
      match.push(
        sql`exists (select 1 from core.record_links l where l.org_id = v.org_id and l.relation = 'uses_kit'
                     and l.from_type = 'pm_variant' and l.from_id = v.id::text and (${sql.join(kits, sql` or `)}))`,
      );
    }
    const rows = await query<{
      program_id: string;
      key: string;
      name: string;
      status: BridgeProgramStatus;
      unit_singular: string | null;
      unit_plural: string | null;
      timezone: string | null;
      org_timezone: string | null;
      variant_id: string;
      variant_name: string;
      sku: string | null;
    }>(
      db,
      sql`select p.id::text as program_id, p.key, p.name, p.status, ps.unit_singular, ps.unit_plural, ps.timezone, oc.timezone as org_timezone,
                 v.id::text as variant_id, v.name as variant_name, v.sku
            from pm.program_variants v
            join pm.projects p on p.id = v.program_id
            left join pm.program_settings ps on ps.program_id = p.id
            left join pm.org_calendar oc on oc.org_id = p.org_id
           where v.org_id = ${actor.orgId}::uuid and v.deleted_at is null and p.kind = 'program' and p.is_template = false
             and p.archived_at is null and ${visibleProjects(role, actor.userId)} and (${sql.join(match, sql` or `)})
           order by p.name, v.position collate "C"
           limit 50`,
    );
    const now = options.now ?? new Date();
    const programs: KitProgram[] = [];
    for (const row of rows) {
      const today = todayIn(safeTimezone(row.timezone ?? row.org_timezone), now);
      const weekFrom = startOfWeek(today, 1);
      const weekTo = addDays(weekFrom, 6);
      const month = monthOf(today);
      const [facts] = await query<{ planned: string; built: string; next: string | null }>(
        db,
        sql`select
              (select coalesce(sum(b.planned_qty), 0)::text from pm.builds b
                 join pm.tasks t on t.id = b.task_id and t.deleted_at is null join pm.statuses s on s.id = t.status_id
                where b.variant_id = ${row.variant_id}::uuid and s.category <> 'cancelled'
                  and b.build_date between ${weekFrom}::date and ${weekTo}::date) as planned,
              (select coalesce(sum(o.qty), 0)::text from pm.build_output o join pm.tasks t on t.id = o.build_id and t.deleted_at is null
                 join pm.builds b on b.task_id = o.build_id
                where b.variant_id = ${row.variant_id}::uuid and o.deleted_at is null
                  and o.work_date between ${`${month}-01`}::date and ${today}::date) as built,
              (select min(b.build_date)::text from pm.builds b
                 join pm.tasks t on t.id = b.task_id and t.deleted_at is null join pm.statuses s on s.id = t.status_id
                where b.variant_id = ${row.variant_id}::uuid and s.category not in ('done', 'cancelled')
                  and b.build_date >= ${today}::date) as next`,
      );
      const status = (row.status in BRIDGE_PROGRAM_STATUS_LABELS ? row.status : 'active') as BridgeProgramStatus;
      programs.push({
        key: row.key,
        name: row.name,
        url: programUrl(urls, row.key),
        status,
        statusLabel: BRIDGE_PROGRAM_STATUS_LABELS[status],
        unit: { singular: row.unit_singular ?? 'kit', plural: row.unit_plural ?? 'kits' },
        variant: { id: row.variant_id, name: row.variant_name, sku: row.sku },
        plannedThisWeek: fromScaled(quantityToScaled(facts?.planned ?? '0'), 3),
        builtThisMonth: fromScaled(quantityToScaled(facts?.built ?? '0'), 3),
        nextBuildDate: facts?.next ?? null,
      });
    }
    return { available: true, programs };
  } catch (error) {
    console.warn('[pm-bridge] listProgramsForKit failed', error);
    return NOT_INSTALLED;
  }
}
