/**
 * Alert work the money ops screens need on top of `alerts.ts`: rules with quiet hours, bulk
 * changes in the inbox, tab counts, and the rule preview ("what would this rule have told me in
 * the last 30 days?").
 *
 * The preview replays a rule against each day's real numbers (cumulative revenue and cost per
 * job from `fact_days`, daily units and hours from the work log). Live alerts also look at the
 * projected finish, so a live alert can fire a little earlier than the replay shows; the screen
 * says so. Rules that cannot be replayed (a status at one moment, like "no price") fall back to
 * the alerts the rule really raised.
 */
import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { alertRules } from '@/server/db/schema';
import { invalid, notFound } from '@/server/errors';
import { ALERT_KINDS, type AlertKind, type AlertSeverity, type AlertStatus } from '@/lib/constants';
import { formatMoneyWhole } from '@/lib/format';
import { addDays, isWorkDay, startOfMonth, workDaysBetween } from '@/lib/profit';
import { isClockTime, type QuietHours } from '@/features/alerts/quiet-hours';
import type { AlertDTO, AlertRuleDTO } from '@/lib/types';
import { isUuid, rows, todayInZone, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { createAlertRule, updateAlert, updateAlertRule, type AlertChange, type AlertRuleInput } from './alerts';
import { loadSettings } from './settings';

/* ---------------------------------------------------------------- rules with quiet hours */

export interface AlertRuleFullInput extends AlertRuleInput {
  quiet?: QuietHours | null;
}

function cleanQuiet(quiet: QuietHours | null | undefined): QuietHours | null {
  if (!quiet) return null;
  const hasWindow = quiet.from !== quiet.to;
  if (hasWindow && (!isClockTime(quiet.from) || !isClockTime(quiet.to))) throw invalid('Pick a start and an end time for quiet hours.', { quiet: 'Pick a start and an end time.' });
  if (!hasWindow && !quiet.weekends) return null;
  return hasWindow ? { from: quiet.from, to: quiet.to, weekends: Boolean(quiet.weekends) } : { from: '00:00', to: '00:00', weekends: true };
}

/** Writes the whole scope (filters plus quiet hours) of a rule. The stock update only knows the three filters. */
async function writeScope(ctx: DomainContext, ruleId: string, scope: AlertRuleInput['scope'], quiet: QuietHours | null): Promise<AlertRuleDTO> {
  const next: Record<string, unknown> = {};
  for (const key of ['clientId', 'jobTypeId', 'siteId'] as const) {
    const value = scope?.[key];
    if (value && isUuid(value)) next[key] = value;
  }
  if (quiet) next.quiet = quiet;
  const [row] = await db.update(alertRules).set({ scope: next, updatedAt: new Date() }).where(and(eq(alertRules.orgId, ctx.orgId), eq(alertRules.id, ruleId), isNull(alertRules.deletedAt))).returning();
  if (!row) throw notFound('That rule');
  return { id: row.id, name: row.name, kind: row.kind as AlertKind, threshold: row.threshold, scope: row.scope ?? {}, severity: row.severity as AlertSeverity, notifyRoles: row.notifyRoles, notifyUserIds: row.notifyUserIds, enabled: row.enabled, isSystem: row.isSystem };
}

/** Creates or changes a rule, quiet hours included. One call for the rule editor. */
export async function saveAlertRuleFull(ctx: DomainContext, input: AlertRuleFullInput & { id?: string | null }): Promise<AlertRuleDTO> {
  await requirePulse(ctx, 'alert:manage');
  const quiet = cleanQuiet(input.quiet);
  const { id, quiet: _quiet, ...rule } = input;
  void _quiet;
  const saved = id ? await updateAlertRule(ctx, id, rule) : await createAlertRule(ctx, rule);
  return writeScope(ctx, saved.id, input.scope ?? (saved.scope as AlertRuleInput['scope']), quiet);
}

/* ---------------------------------------------------------------- inbox */

/** How many alerts sit in each inbox tab. */
export async function countAlertsByStatus(ctx: DomainContext): Promise<Readonly<Record<AlertStatus, number>> & { readonly mine: number }> {
  await requirePulse(ctx, 'pulse:read');
  const found = await rows<{ status: AlertStatus; n: number; mine: number }>(
    db,
    sql`SELECT status, count(*)::int AS n, count(*) FILTER (WHERE assigned_to = ${ctx.userId} AND status = 'open')::int AS mine FROM pulse.alerts WHERE org_id = ${ctx.orgId} GROUP BY status`,
  );
  const out = { open: 0, snoozed: 0, resolved: 0, dismissed: 0, mine: 0 };
  for (const row of found) {
    out[row.status] = row.n;
    out.mine += row.mine;
  }
  return out;
}

/** The same change on many alerts. Each one is its own small transaction, so one stale row never blocks the rest. */
export async function bulkUpdateAlerts(ctx: DomainContext, alertIds: readonly string[], change: AlertChange): Promise<{ updated: AlertDTO[]; failed: number }> {
  await requirePulse(ctx, change.action === 'assign' || change.action === 'link_task' ? 'alert:manage' : 'production:log');
  const ids = [...new Set(alertIds)].filter(isUuid).slice(0, 500);
  if (ids.length === 0) throw invalid('Pick at least one alert.');
  const updated: AlertDTO[] = [];
  let failed = 0;
  for (const id of ids) {
    try {
      updated.push(await updateAlert(ctx, id, change));
    } catch {
      failed += 1;
    }
  }
  if (updated.length === 0) throw invalid('None of those alerts could be changed. Refresh the page and try again.');
  return { updated, failed };
}

/* ---------------------------------------------------------------- preview */

export interface RulePreviewInput {
  kind: AlertKind;
  threshold?: string | null;
  scope?: { clientId?: string | null; jobTypeId?: string | null; siteId?: string | null };
  /** When the rule exists, its real alerts are used for kinds that cannot be replayed. */
  ruleId?: string | null;
}

export interface RulePreviewHit {
  readonly date: string;
  readonly label: string;
  readonly detail: string;
  readonly url: string | null;
  /** True when the condition was already true on the first day of the window. */
  readonly sinceBefore: boolean;
}

export interface RulePreviewDTO {
  readonly from: string;
  readonly to: string;
  /** `replay`: worked out day by day from real numbers. `history`: the alerts this rule really raised. */
  readonly basis: 'replay' | 'history';
  readonly total: number;
  /** How many of the hits are still true today. */
  readonly activeToday: number;
  readonly hits: readonly RulePreviewHit[];
  /** One number per day of the window, oldest first: how many times the rule would have spoken that day. */
  readonly perDay: readonly number[];
  readonly note: string;
}

interface JobBase {
  id: string;
  number: string;
  name: string;
  client_id: string;
  job_type_id: string;
  site_id: string;
  status: string;
  start_date: string | null;
  completed_date: string | null;
  target_margin_bp: number | null;
  standard_uph: string | null;
  plan_units: string | null;
  plan_labor: string | null;
  plan_material: string | null;
}

interface DayMoney {
  job_id: string;
  d: string;
  revenue: string;
  cost: string;
  labor: string;
  material: string;
  billed: string;
}

interface DayWork {
  job_id: string;
  d: string;
  units: string;
  pace_hours: string;
  confirmed_hours: string;
  needs_rate: number;
}

const pct = (bp: number): string => `${Math.round(bp / 100)}%`;
const usd = (cents: number): string => formatMoneyWhole(Math.round(cents));
const REPLAYED: readonly string[] = ['job_losing', 'job_at_risk', 'margin_below', 'labor_over_budget', 'material_over_budget', 'productivity_below', 'no_entry_days', 'unbilled_above', 'missing_hours', 'missing_rate', 'client_margin_below', 'vas_margin_below', 'missing_time_above'];

/**
 * What a rule would have told you over the last 30 days. A hit is counted on the day a condition
 * turns true (not on every day it stays true), the same way a live alert is one alert while its
 * condition lasts.
 */
export async function previewAlertRule(ctx: DomainContext, input: RulePreviewInput): Promise<RulePreviewDTO> {
  const access = await requirePulse(ctx, 'alert:manage');
  if (!(ALERT_KINDS as readonly string[]).includes(input.kind)) throw invalid('Pick what the rule watches.');
  const settings = await loadSettings(ctx.orgId);
  const today = todayInZone(settings.timezone);
  const from = addDays(today, -29);
  const days: string[] = Array.from({ length: 30 }, (_, index) => addDays(from, index));
  const dayIndex = new Map(days.map((day, index) => [day, index]));
  const threshold = input.threshold === null || input.threshold === undefined || input.threshold === '' ? null : Number(input.threshold);
  const scope = input.scope ?? {};
  const money = access.seesMoney;
  const hits: RulePreviewHit[] = [];
  const perDay = days.map(() => 0);
  let activeToday = 0;
  const hit = (date: string, label: string, detail: string, url: string | null, sinceBefore: boolean) => {
    hits.push({ date, label, detail, url, sinceBefore });
    const index = dayIndex.get(date);
    if (index !== undefined) perDay[index] = (perDay[index] ?? 0) + 1;
  };
  /** Walks a per day true or false series and records the days it turns true. */
  const edges = (series: readonly (string | null)[], label: string, url: string | null) => {
    let on = false;
    series.forEach((detail, index) => {
      if (detail !== null && !on) hit(days[index]!, label, detail, url, index === 0);
      on = detail !== null;
    });
    if (on) activeToday += 1;
  };

  if (!REPLAYED.includes(input.kind)) {
    const ruleId = input.ruleId && isUuid(input.ruleId) ? input.ruleId : null;
    const found = await rows<{ d: string; kind: string; params: Record<string, unknown>; url: string | null; status: string }>(
      db,
      sql`SELECT to_char((first_seen_at AT TIME ZONE ${settings.timezone})::date, 'YYYY-MM-DD') AS d, kind, params, url, status
            FROM pulse.alerts WHERE org_id = ${ctx.orgId} AND kind = ${input.kind} ${ruleId ? sql`AND rule_id = ${ruleId}` : sql``}
             AND first_seen_at >= ${from}::date ORDER BY first_seen_at DESC LIMIT 200`,
    );
    const { renderAlertWords } = await import('./alert-words');
    for (const row of found) {
      const words = renderAlertWords(row.kind, row.params ?? {}, money);
      hit(row.d, words.title, words.body, row.url, false);
      if (row.status === 'open' || row.status === 'snoozed') activeToday += 1;
    }
    return { from, to: today, basis: 'history', total: hits.length, activeToday, hits: hits.slice(0, 60), perDay, note: 'This kind of rule looks at how things stand right now, so it cannot be replayed day by day. These are the alerts it really raised in the last 30 days.' };
  }

  if (input.kind === 'client_margin_below' || input.kind === 'vas_margin_below') {
    if (threshold === null) throw invalid('Type the margin the rule should watch for.', { threshold: 'Type a percent, like 15.' });
    const byClient = input.kind === 'client_margin_below';
    const found = await rows<{ id: string; name: string; d: string; revenue: string; cost: string }>(
      db,
      byClient
        ? sql`SELECT c.id, c.name, to_char(f.work_date, 'YYYY-MM-DD') AS d, sum(CASE WHEN f.kind LIKE 'revenue%' THEN f.amount_cents ELSE 0 END)::text AS revenue,
                     sum(CASE WHEN f.kind IN ('labor', 'material', 'other', 'shared') THEN f.amount_cents ELSE 0 END)::text AS cost
                FROM pulse.fact_days f JOIN pulse.clients c ON c.id = f.client_id
               WHERE f.org_id = ${ctx.orgId} AND f.work_date > ${from}::date - 30 AND f.work_date <= ${today}::date ${scope.clientId ? sql`AND f.client_id = ${scope.clientId}` : sql``} ${scope.siteId ? sql`AND f.site_id = ${scope.siteId}` : sql``}
               GROUP BY c.id, c.name, f.work_date`
        : sql`SELECT s.id, s.name, to_char(f.work_date, 'YYYY-MM-DD') AS d, sum(CASE WHEN f.kind LIKE 'revenue%' THEN f.amount_cents ELSE 0 END)::text AS revenue,
                     sum(CASE WHEN f.kind IN ('labor', 'material', 'other', 'shared') THEN f.amount_cents ELSE 0 END)::text AS cost
                FROM pulse.fact_days f JOIN pulse.vas_services s ON s.id = f.vas_service_id
               WHERE f.org_id = ${ctx.orgId} AND f.work_date > ${from}::date - 30 AND f.work_date <= ${today}::date ${scope.clientId ? sql`AND f.client_id = ${scope.clientId}` : sql``} ${scope.siteId ? sql`AND f.site_id = ${scope.siteId}` : sql``}
               GROUP BY s.id, s.name, f.work_date`,
    );
    const groups = new Map<string, { name: string; byDay: Map<string, { revenue: number; cost: number }> }>();
    for (const row of found) {
      const group = groups.get(row.id) ?? { name: row.name, byDay: new Map() };
      group.byDay.set(row.d, { revenue: Number(row.revenue), cost: Number(row.cost) });
      groups.set(row.id, group);
    }
    const bp = Math.round(threshold * 100);
    for (const [id, group] of groups) {
      const series = days.map((day) => {
        let revenue = 0;
        let cost = 0;
        for (let back = 0; back < 30; back += 1) {
          const cell = group.byDay.get(addDays(day, -back));
          if (cell) {
            revenue += cell.revenue;
            cost += cell.cost;
          }
        }
        if (!(revenue > 0)) return null;
        const marginBp = Math.round(((revenue - cost) / revenue) * 10000);
        return marginBp < bp ? (money ? `Margin over the 30 days before was ${pct(marginBp)}. Your line is ${pct(bp)}.` : 'Margin was under your line.') : null;
      });
      edges(series, group.name, byClient ? `/clients/${id}` : `/services/${id}`);
    }
    return finish('Worked out day by day from the last 30 days of real revenue and cost.');
  }

  if (input.kind === 'missing_time_above') {
    const found = await rows<{ d: string; cents: string; hours: string }>(db, sql`SELECT to_char(work_date, 'YYYY-MM-DD') AS d, sum(missing_cents)::text AS cents, sum(missing_hours)::text AS hours FROM pulse.company_days WHERE org_id = ${ctx.orgId} AND work_date >= ${startOfMonth(from)}::date AND work_date <= ${today}::date GROUP BY work_date`);
    const byDay = new Map(found.map((row) => [row.d, { cents: Number(row.cents), hours: Number(row.hours) }]));
    const limit = (threshold ?? 0) * 100;
    const series = days.map((day) => {
      let cents = 0;
      let hours = 0;
      for (let cursor = startOfMonth(day); cursor <= day; cursor = addDays(cursor, 1)) {
        const cell = byDay.get(cursor);
        if (cell) {
          cents += cell.cents;
          hours += cell.hours;
        }
      }
      return cents > limit && hours > 0 ? (money ? `${usd(cents)} of paid time that month was not on a job or a reason.` : `${Math.round(hours)} paid hours that month were not on a job or a reason.`) : null;
    });
    // A new month starts a new count, so each month can raise it once.
    edges(series, 'Paid time not on any job', '/labor?tab=time');
    return finish('Worked out day by day from paid hours against logged hours, month to date.');
  }

  const jobs = await rows<JobBase>(
    db,
    sql`SELECT j.id, j.number, j.name, j.client_id, j.job_type_id, j.site_id, j.status, to_char(j.start_date, 'YYYY-MM-DD') AS start_date, to_char(j.completed_date, 'YYYY-MM-DD') AS completed_date,
               st.target_margin_bp, st.standard_uph::text, p.units::text AS plan_units, p.labor_cents::text AS plan_labor, p.material_cents::text AS plan_material
          FROM pulse.jobs j JOIN pulse.job_stats st ON st.job_id = j.id
          LEFT JOIN LATERAL (SELECT units, labor_cents, material_cents FROM pulse.job_plans jp WHERE jp.job_id = j.id ORDER BY (jp.plan = 'budget') DESC LIMIT 1) p ON true
         WHERE j.org_id = ${ctx.orgId} AND j.deleted_at IS NULL AND j.archived_at IS NULL AND j.status IN ('active', 'completed')
           ${scope.clientId ? sql`AND j.client_id = ${scope.clientId}` : sql``} ${scope.jobTypeId ? sql`AND j.job_type_id = ${scope.jobTypeId}` : sql``} ${scope.siteId ? sql`AND j.site_id = ${scope.siteId}` : sql``}`,
  );
  if (jobs.length === 0) return finish('No active or finished jobs match this rule yet.');
  const [moneyRows, workRows] = await Promise.all([
    rows<DayMoney>(
      db,
      sql`SELECT f.job_id, to_char(f.work_date, 'YYYY-MM-DD') AS d,
                 sum(CASE WHEN f.kind LIKE 'revenue%' THEN f.amount_cents ELSE 0 END)::text AS revenue,
                 sum(CASE WHEN f.kind IN ('labor', 'material', 'other', 'shared') THEN f.amount_cents ELSE 0 END)::text AS cost,
                 sum(CASE WHEN f.kind = 'labor' THEN f.amount_cents ELSE 0 END)::text AS labor,
                 sum(CASE WHEN f.kind = 'material' THEN f.amount_cents ELSE 0 END)::text AS material,
                 sum(CASE WHEN f.kind = 'billed_memo' THEN f.amount_cents ELSE 0 END)::text AS billed
            FROM pulse.fact_days f WHERE f.org_id = ${ctx.orgId} AND f.job_id IS NOT NULL AND f.work_date <= ${today}::date GROUP BY f.job_id, f.work_date`,
    ),
    rows<DayWork>(
      db,
      sql`SELECT p.job_id, to_char(p.work_date, 'YYYY-MM-DD') AS d, sum(p.units_good)::text AS units, sum(p.hours - p.setup_hours)::text AS pace_hours,
                 COALESCE(sum(p.hours) FILTER (WHERE p.hours_confirmed), 0)::text AS confirmed_hours, count(*) FILTER (WHERE p.needs_rate)::int AS needs_rate
            FROM pulse.production_entries p WHERE p.org_id = ${ctx.orgId} AND p.deleted_at IS NULL AND p.work_date <= ${today}::date GROUP BY p.job_id, p.work_date`,
    ),
  ]);
  const moneyByJob = new Map<string, DayMoney[]>();
  for (const row of moneyRows) moneyByJob.set(row.job_id, [...(moneyByJob.get(row.job_id) ?? []), row]);
  const workByJob = new Map<string, DayWork[]>();
  for (const row of workRows) workByJob.set(row.job_id, [...(workByJob.get(row.job_id) ?? []), row]);
  const workingDays = settings.workingDays;
  const unbilledLimit = threshold !== null ? threshold * 100 : Number(settings.unbilledAlertCents);

  for (const job of jobs) {
    const label = `${job.number} ${job.name}`;
    const url = `/jobs/${encodeURIComponent(job.number)}`;
    const moneyDays = (moneyByJob.get(job.id) ?? []).sort((a, b) => (a.d < b.d ? -1 : 1));
    const workDays = (workByJob.get(job.id) ?? []).sort((a, b) => (a.d < b.d ? -1 : 1));
    if (moneyDays.length === 0 && workDays.length === 0) continue;
    const target = job.target_margin_bp ?? settings.defaultTargetMarginBp;
    const planUnits = Number(job.plan_units ?? 0);
    let mi = 0;
    let wi = 0;
    const sum = { revenue: 0, cost: 0, labor: 0, material: 0, billed: 0, units: 0 };
    let lastEntry: string | null = null;
    // Roll the totals forward to the day before the window.
    const roll = (day: string): DayWork | null => {
      let todayWork: DayWork | null = null;
      while (mi < moneyDays.length && moneyDays[mi]!.d <= day) {
        const row = moneyDays[mi]!;
        sum.revenue += Number(row.revenue);
        sum.cost += Number(row.cost);
        sum.labor += Number(row.labor);
        sum.material += Number(row.material);
        sum.billed += Number(row.billed);
        mi += 1;
      }
      while (wi < workDays.length && workDays[wi]!.d <= day) {
        const row = workDays[wi]!;
        sum.units += Number(row.units);
        lastEntry = row.d;
        if (row.d === day) todayWork = row;
        wi += 1;
      }
      return todayWork;
    };
    roll(addDays(from, -1));
    const series = days.map((day): string | null => {
      const work = roll(day);
      const open = job.status === 'active' || (job.completed_date !== null && job.completed_date > day);
      const marginBp = sum.revenue > 0 ? Math.round(((sum.revenue - sum.cost) / sum.revenue) * 10000) : null;
      const share = planUnits > 0 ? Math.min(1, sum.units / planUnits) : null;
      switch (input.kind) {
        case 'job_losing':
          return sum.revenue > 0 && sum.cost > sum.revenue ? (money ? `Cost had passed revenue by ${usd(sum.cost - sum.revenue)}.` : 'Cost had passed revenue.') : null;
        case 'job_at_risk':
          return marginBp !== null && marginBp >= 0 && marginBp < target - settings.atRiskGapBp ? (money ? `Margin was ${pct(marginBp)} against a ${pct(target)} target.` : 'Margin was well under the target.') : null;
        case 'margin_below':
          if (threshold === null) return null;
          return marginBp !== null && marginBp < Math.round(threshold * 100) ? (money ? `Margin was ${pct(marginBp)}. Your line is ${pct(Math.round(threshold * 100))}.` : 'Margin was under your line.') : null;
        case 'labor_over_budget': {
          const plan = Number(job.plan_labor ?? 0);
          if (!(plan > 0) || share === null || share <= 0) return null;
          const over = sum.labor / (plan * share) - 1;
          return over * 10000 > settings.laborWatchOverBp ? `Labor was ${Math.round(over * 100)}% over the plan for the work done.` : null;
        }
        case 'material_over_budget': {
          const plan = Number(job.plan_material ?? 0);
          if (!(plan > 0) || share === null || share <= 0) return null;
          const over = sum.material / (plan * share) - 1;
          return over * 10000 > settings.materialWatchOverBp ? `Material was ${Math.round(over * 100)}% over the plan for the work done.` : null;
        }
        case 'productivity_below': {
          const standard = Number(job.standard_uph ?? 0);
          if (!work || !(standard > 0) || !(Number(work.pace_hours) > 0) || !(Number(work.units) > 0)) return null;
          const uph = Number(work.units) / Number(work.pace_hours);
          return uph * 10000 < standard * settings.productivityRiskBp ? `The crew made ${Math.round(uph)} units per person per hour. The target pace is ${Math.round(standard)}.` : null;
        }
        case 'no_entry_days': {
          if (!open || job.status !== 'active' || !isWorkDay(day, workingDays)) return null;
          const since = lastEntry ?? job.start_date;
          if (!since || since >= day) return null;
          const gap = workDaysBetween(addDays(since, 1), day, workingDays);
          return gap >= settings.noEntryDays ? `Nothing was logged for ${gap} work days.` : null;
        }
        case 'unbilled_above': {
          const notBilled = sum.revenue - sum.billed;
          if (!(notBilled > unbilledLimit) || !lastEntry || lastEntry > addDays(day, -settings.unbilledAlertDays)) return null;
          return money ? `${usd(notBilled)} of finished work was not on an invoice.` : 'Finished work was not on an invoice.';
        }
        case 'missing_hours':
          return work && Number(work.units) > 0 && Number(work.confirmed_hours) === 0 ? 'Units were logged with no hours.' : null;
        case 'missing_rate':
          return work && work.needs_rate > 0 ? 'Hours were logged with no labor rate.' : null;
        default:
          return null;
      }
    });
    edges(series, label, url);
  }
  return finish(
    input.kind === 'missing_hours' || input.kind === 'missing_rate' || input.kind === 'no_entry_days' || input.kind === 'productivity_below'
      ? 'Worked out day by day from the work log.'
      : "Worked out day by day from each job's real revenue and cost so far. Live alerts also look at the projected finish, so they can speak up a little earlier.",
  );

  function finish(note: string): RulePreviewDTO {
    hits.sort((a, b) => (a.date === b.date ? a.label.localeCompare(b.label) : a.date < b.date ? 1 : -1));
    return { from, to: today, basis: 'replay', total: hits.length, activeToday, hits: hits.slice(0, 60), perDay, note };
  }
}
