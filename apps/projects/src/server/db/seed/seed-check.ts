/**
 * Seed check (docs/programs/SPEC.md 7.4). Prints the facts every program screen shows, read
 * through the same domain calls the app uses, and on a 2026-11-25 run compares GLOVE with the
 * exact spec values (the seed fails on a mismatch). On any other date it checks that the facts
 * agree with each other (month totals add up, today sits inside the month, forecast covers MTD).
 *
 * Runs at the end of `pnpm --filter kitstak-projects db:seed`; the seed fails when it finds a problem.
 */
import { sql } from 'drizzle-orm';
import { addDays, changeBp, formatCents, formatPercentBp, formatQty } from '@kitstak/programs-engine';
import { listLinkedPrograms } from '@kitstak/pm-bridge/programs';
import type { BridgeExecutor } from '@kitstak/pulse-bridge';
import { db } from '@/server/db';
import type { DomainContext } from '@/server/domain/_shared';
import { floorToday, getProgramSummary, getStatement, listPrograms, listSchedules } from '@/server/domain/programs';
import type { ProgramAlertDTO, ProgramSummaryDTO } from '@/lib/program-types';
import { compareWithLastMonth, cumulativeThrough, finishedDaysAverage, SAME_AS_LAST_MONTH, workDaysSoFar } from '@/features/programs/overview/overview-model';

export const CHECK_DATE = '2026-11-25';

/** The SPEC 7.4 values for GLOVE on a 2026-11-25 run. */
export const GLOVE_EXPECTED: Readonly<Record<string, string>> = {
  'September total': '$21,660.00',
  'October total': '$31,500.00',
  'October minimum top up': '$165.00',
  'November work charges through Nov 24': '$27,378.40',
  Today: '5 of 8 builds done · 560 of 800 kits · $1,092.00',
  'This month (MTD)': '$29,970.40',
  'Work charges this month': '$28,470.40',
  'Monthly fee': '$1,500.00',
  'Built this month': '14,172 kits · Avg 801 a work day',
  'Built this month (screen)': '14,172 kits · Avg 801 a work day',
  'vs last month at this point': 'up 27% vs last month at this point',
  'vs last month at this point (screen)': 'up 27% vs last month at this point',
  'October through Oct 25': '$23,685.00',
  Forecast: '$33,708.40 · 105% of $32,000.00 target',
  'Planned work still to come': '$3,738.00',
  Health: 'on_track',
  'Forecast basis': 'Based on planned builds',
  Minimum: 'Below minimum by $1,529.60 so far · projected gap $0.00',
  Alerts: 'over_plan',
  'Schedule window': 'builds made through 2026-12-02',
  'Deal line': 'Deal $386,400.00 over 12 months · on track for $390,244.00',
  'All linked work': 'Program $29,970.40 · Other linked jobs $4,200.00 · Total $34,170.40',
};

const usd = (cents: bigint): string => formatCents(cents, { cents: true });
const money = (cents: string | null | undefined): string => (cents === null || cents === undefined ? 'hidden' : usd(BigInt(cents)));

function monthOffset(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function alertText(alert: ProgramAlertDTO): string {
  return alert.kind;
}

export interface ProgramFacts {
  readonly key: string;
  readonly facts: Readonly<Record<string, string>>;
}

async function factsFor(ctx: DomainContext, key: string, includePulse: boolean): Promise<ProgramFacts> {
  const summary: ProgramSummaryDTO = await getProgramSummary(ctx, key);
  const month = summary.month;
  const facts: Record<string, string> = {};
  const unit = await db.execute<{ unit: string; start: string | null; target: string | null }>(
    sql`select ps.unit_plural as unit, p.start_date::text as start, ps.monthly_target_cents::text as target from pm.projects p join pm.program_settings ps on ps.program_id = p.id where p.org_id = ${ctx.orgId}::uuid and p.key = ${key} and p.kind = 'program'`,
  );
  const plural = unit.rows[0]?.unit ?? 'units';
  const start = unit.rows[0]?.start ?? summary.asOf;
  // Every month from the start to last month.
  for (let m = start.slice(0, 7); m < month; m = monthOffset(m, 1)) {
    const statement = await getStatement(ctx, key, m);
    const name = new Date(`${m}-01T12:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    facts[`${name} total`] = money(statement.totals.totalCents);
    if (BigInt(statement.totals.topUpCents) > BigInt(0)) facts[`${name} minimum top up`] = money(statement.totals.topUpCents);
    facts[`${name} closed`] = statement.closed ? 'yes' : 'no';
  }
  const result = summary.result;
  // Work charges on the days before today (by work date, so a multi day build counts its own days).
  const workBefore = summary.byDay.filter((d) => d.date < summary.asOf).reduce((n, d) => n + BigInt(d.workCents ?? '0'), BigInt(0));
  const monthName = new Date(`${month}-01T12:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  facts[`${monthName} work charges through ${new Date(`${addDays(summary.asOf, -1)}T12:00:00Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`] = usd(workBefore);
  facts.Today = `${summary.today.done} of ${summary.today.builds} builds done · ${formatQty(summary.today.builtUnits)} of ${formatQty(summary.today.plannedUnits)} ${plural} · ${money(summary.today.revenueCents)}`;
  facts['This month (MTD)'] = money(result.totalCents);
  facts['Work charges this month'] = result.work ? money(result.work.totalCents) : '$0.00';
  if (result.fixed && BigInt(result.fixed.monthlyFeeCents) > BigInt(0)) facts['Monthly fee'] = money(result.fixed.monthlyFeeCents);
  // SPEC 7.4 average: units on the work days before today, over those days (today is still running).
  const before = summary.byDay.filter((d) => d.date < summary.asOf && Number(d.units) > 0);
  const beforeUnits = before.reduce((n, d) => n + Number(d.units), 0);
  facts['Built this month'] = `${formatQty(result.units)} ${plural} · Avg ${formatQty(String(before.length > 0 ? Math.round(beforeUnits / before.length) : 0))} a work day`;
  facts['Work days with output (incl. today)'] = String(workDaysSoFar(summary.byDay, summary.asOf));
  // What the Overview KPI prints, from the same helpers the screen uses (must equal the line above).
  facts['Built this month (screen)'] = `${formatQty(result.units)} ${plural} · ${finishedDaysAverage(summary.byDay, summary.asOf) ?? 'no average yet'}`;
  const last = await getProgramSummary(ctx, key, { month: monthOffset(month, -1) }).catch(() => null);
  const compare = compareWithLastMonth(summary.byDay, last?.byDay, summary.asOf);
  if (compare) facts['vs last month at this point (screen)'] = compare.text;
  if (last) {
    // SPEC 7.4 rounds the change to the nearest whole percent.
    const dom = Number(summary.asOf.slice(8, 10));
    const now = cumulativeThrough(summary.byDay, dom);
    const then = cumulativeThrough(last.byDay, dom);
    const bp = now !== null && then !== null ? changeBp(now, then) : null;
    if (bp !== null) {
      const pct = Math.round(Math.abs(bp) / 100);
      facts['vs last month at this point'] = pct === 0 ? SAME_AS_LAST_MONTH : `${bp > 0 ? 'up' : 'down'} ${pct}% vs last month at this point`;
    }
  }
  if (last) {
    const dom = Number(summary.asOf.slice(8, 10));
    const through = [...last.byDay].filter((d) => Number(d.date.slice(8, 10)) <= dom && d.cumulativeCents !== null).pop();
    const lastName = new Date(`${last.month}-01T12:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    if (through) facts[`${lastName} through ${lastName.slice(0, 3)} ${dom}`] = money(through.cumulativeCents);
  }
  const forecast = summary.forecast;
  const target = unit.rows[0]?.target;
  facts.Forecast = `${money(forecast.forecastCents)}${forecast.targetBp !== null && target ? ` · ${formatPercentBp(forecast.targetBp)} of ${usd(BigInt(target))} target` : ''}`;
  facts['Forecast basis'] = forecast.methodText;
  // Open today ($518.00 on the check date) plus the planned builds after today (Nov 27 and Nov 30).
  // The forecast includes a projected minimum top up; planned work leaves it out (MAHCO).
  if (forecast.forecastCents !== null && result.totalCents !== null) {
    const topUp = result.minimum && result.minimum.status !== 'none' ? BigInt(forecast.projectedGapCents ?? '0') : BigInt(0);
    facts['Planned work still to come'] = usd(BigInt(forecast.forecastCents) - topUp - BigInt(result.totalCents));
    if (topUp > BigInt(0)) facts['Forecast incl. top up'] = `${usd(BigInt(forecast.forecastCents))} (work ${usd(BigInt(forecast.forecastCents) - topUp)} plus a projected top up of ${usd(topUp)})`;
  }
  if (result.minimum && result.minimum.status !== 'none') {
    const gap = BigInt(result.minimum.gapSoFarCents);
    facts.Minimum = `${gap > BigInt(0) ? `Below minimum by ${usd(gap)} so far` : result.minimum.statusText} · projected gap ${money(forecast.projectedGapCents ?? '0')}`;
  }
  facts.Alerts = summary.alerts.map(alertText).join(', ') || 'none';
  const listed = (await listPrograms(ctx).catch(() => [])).find((p) => p.key === key);
  if (listed) facts.Health = `${listed.health ?? 'none'}${listed.healthBasis ? ` (${listed.healthBasis})` : ''}`;
  const [schedule] = await listSchedules(ctx, key);
  if (schedule?.generatedThrough) facts['Schedule window'] = `builds made through ${schedule.generatedThrough}`;
  if (includePulse) {
    if (summary.linkedWork) facts['All linked work'] = `Program ${money(summary.linkedWork.programCents)} · Other linked jobs ${money(summary.linkedWork.relatedCents)} · Total ${money(summary.linkedWork.totalCents)}`;
    if (summary.pulse) facts.Pulse = summary.pulse.text;
  }
  return { key, facts };
}

async function dealLine(ctx: DomainContext, key: string): Promise<string | null> {
  const deal = await db.execute<{ id: string }>(sql`select to_id as id from core.record_links where org_id = ${ctx.orgId}::uuid and relation = 'created_from' and to_type = 'crm_deal'
    and from_type = 'pm_program' and from_id = (select id::text from pm.projects where org_id = ${ctx.orgId}::uuid and key = ${key} and kind = 'program')`);
  const dealId = deal.rows[0]?.id;
  if (!dealId) return null;
  const listed = await listLinkedPrograms(db as unknown as BridgeExecutor, { orgId: ctx.orgId, userId: ctx.userId }, [{ type: 'crm_item', id: dealId }], { projectsUrl: 'http://localhost:3400' });
  if (!listed.available) return null;
  const program = listed.programs.find((p) => p.key === key);
  if (!program?.deal) return null;
  return `Deal ${usd(BigInt(program.deal.valueCents))} over ${program.deal.termMonths ?? 12} months · on track for ${program.deal.onTrackForCents ? usd(BigInt(program.deal.onTrackForCents)) : 'not known yet'}`;
}

/**
 * Prints the facts for every program of the org and returns the mismatches against 7.4 (only
 * on a 2026-11-25 run, for GLOVE). `pulse` adds the facts that need the Pulse seed.
 */
export async function seedCheck(ctx: DomainContext, options: { readonly pulse?: boolean; readonly today: string }): Promise<string[]> {
  const keys = await db.execute<{ key: string }>(sql`select key from pm.projects where org_id = ${ctx.orgId}::uuid and kind = 'program' and deleted_at is null order by key`);
  const problems: string[] = [];
  const lines: string[] = [`Seed check for ${ctx.orgSlug} on ${options.today}`];
  for (const { key } of keys.rows) {
    const { facts } = await factsFor(ctx, key, Boolean(options.pulse));
    const deal = await dealLine(ctx, key).catch(() => null);
    const all: Record<string, string> = { ...facts, ...(deal ? { 'Deal line': deal } : {}) };
    lines.push('', `${key}`);
    for (const [name, value] of Object.entries(all)) lines.push(`  ${name}: ${value}`);
    if (key === 'GLOVE' && options.today === CHECK_DATE) {
      for (const [name, value] of Object.entries(GLOVE_EXPECTED)) {
        if ((name === 'All linked work' || name === 'Deal line') && !options.pulse) continue;
        const got = all[name];
        if (got === undefined) problems.push(`GLOVE ${name}: missing (want ${value})`);
        else if (name === 'Alerts' || name === 'Health' ? !got.startsWith(value) : got !== value) problems.push(`GLOVE ${name}: got ${got}, want ${value}`);
      }
    }
    // Internal consistency on any date: work plus fixed plus adjustments plus top up is the total.
    const summary = await getProgramSummary(ctx, key);
    const r = summary.result;
    if (r.totalCents !== null && r.work && r.fixed) {
      const parts = BigInt(r.work.totalCents) + BigInt(r.fixed.totalCents) + BigInt(r.adjustments?.totalCents ?? '0') + BigInt(r.minimum?.topUpCents ?? '0');
      if (parts !== BigInt(r.totalCents)) problems.push(`${key}: month parts ${usd(parts)} do not add up to ${usd(BigInt(r.totalCents))}`);
    }
    if (summary.forecast.forecastCents !== null && r.totalCents !== null && BigInt(summary.forecast.forecastCents) < BigInt(r.totalCents)) problems.push(`${key}: forecast is below the money so far`);
    // The Overview prints the same change and average as the seed check (7.4 basis), for every program.
    for (const name of ['vs last month at this point', 'Built this month']) {
      const screen = facts[`${name} (screen)`];
      if (key !== 'GLOVE' && screen !== undefined && facts[name] !== undefined && screen !== facts[name]) problems.push(`${key} ${name}: the Overview shows ${screen}, the seed check ${facts[name]}`);
    }
    // The health pill never says On track while a minimum alert is up (the header and the alert agree).
    if (summary.alerts.some((a) => a.kind === 'minimum_at_risk') && facts.Health?.startsWith('on_track')) problems.push(`${key}: health is On track while the minimum_at_risk alert is active`);
  }
  const floor = await floorToday(ctx).catch(() => null);
  if (floor) {
    lines.push('', `Floor today (${floor.date})`);
    for (const p of floor.programs) {
      const builds = p.runs.reduce((n, r) => n + r.builds, 0);
      const done = p.runs.reduce((n, r) => n + r.done, 0);
      const planned = p.runs.reduce((n, r) => n + Number(r.plannedUnits), 0);
      const built = p.runs.reduce((n, r) => n + Number(r.builtUnits), 0);
      lines.push(`  ${p.key}: ${done} of ${builds} builds done · ${formatQty(String(built))} of ${formatQty(String(planned))} ${p.unit.plural}${p.estHours ? ` · ${p.estHours} hours` : ''}`);
    }
    lines.push(`  Totals: ${floor.totals.done} of ${floor.totals.builds} builds done · ${floor.totals.plannedUnitsByUnit.map((u) => `${formatQty(u.units)} ${u.unit}`).join(', ')} planned${floor.capacityHours ? ` · capacity ${floor.capacityHours} hours` : ''}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  if (problems.length > 0) process.stdout.write(`\nSeed check found ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
  else process.stdout.write(`\nSeed check passed for ${ctx.orgSlug}.\n`);
  return problems;
}
