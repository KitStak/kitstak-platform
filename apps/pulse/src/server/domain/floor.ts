/**
 * Reads for the production screens that span more than one stream (owner: production team):
 * the review queue of days (`/log/review`), the pace against target pace board and the suggested
 * targets (`/target-pace`). Pace numbers come from the pure library (`unitsPerHour`,
 * `productivityBp`, `earnedHours`), never from a formula written here.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { addDays, earnedHours, endOfMonth, productivityBp, shortDate, unitsPerHour, weekdayName } from '@/lib/profit';
import type { DayQueueDTO, PaceBoardDTO, PaceBoardRowDTO, PaceSuggestionRowDTO } from '@/lib/types';
import { monthStart, rows, todayInZone, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { listJobTypes, listSites } from './catalog';
import { closedMonths } from './recalc';
import { dayFlags, listDayReviews } from './reviews';
import { listStandards, suggestStandard } from './standards';

/**
 * The manager queue: every site day of the last `days` days that has work logged or a review
 * state, newest first, with its odd rows computed fresh and the jobs that look forgotten.
 * With `month` (`2026-01`) it is that calendar month instead (up to today), so the month close
 * can link straight to the days it counts.
 */
export const getReviewQueue = scoped(async function getReviewQueue(
  ctx: DomainContext,
  options: { siteId?: string | null; days?: number; month?: string | null } = {},
): Promise<DayQueueDTO[]> {
  await requirePulse(ctx, 'pulse:read');
  const span = Math.min(Math.max(options.days ?? 14, 1), 62);
  const sites = (await listSites(ctx)).filter((site) => !options.siteId || site.id === options.siteId);
  if (sites.length === 0) return [];
  const siteToday = sites.reduce((latest, site) => (site.today > latest ? site.today : latest), sites[0]!.today);
  const month = options.month && /^\d{4}-\d{2}$/.test(options.month) ? `${options.month}-01` : null;
  if (month && month > siteToday) return [];
  const monthEnd = month ? endOfMonth(month) : null;
  const newest = monthEnd && monthEnd < siteToday ? monthEnd : siteToday;
  const from = month ?? addDays(newest, -(span - 1));
  const siteFilter = options.siteId ? sql`AND p.site_id = ${options.siteId}` : sql``;
  const dayRows = await rows<{
    site_id: string;
    d: string;
    entries: number;
    jobs: number;
    units: string;
    hours: string;
  }>(
    db,
    sql`SELECT p.site_id, to_char(p.work_date, 'YYYY-MM-DD') AS d, count(*)::int AS entries, count(DISTINCT p.job_id)::int AS jobs, sum(p.units_good)::text AS units, sum(p.hours)::text AS hours
          FROM pulse.production_entries p
         WHERE p.org_id = ${ctx.orgId} AND p.deleted_at IS NULL AND p.work_date BETWEEN ${from}::date AND ${newest}::date ${siteFilter}
         GROUP BY p.site_id, p.work_date`,
  );
  const reviews = await listDayReviews(ctx, { siteId: options.siteId ?? null, from, to: newest });
  // Jobs logged on a day, per site, to spot a job that ran yesterday and is missing today.
  const jobDays = await rows<{
    site_id: string;
    d: string;
    job_id: string;
    number: string;
    name: string;
    status: string;
    completed: string | null;
  }>(
    db,
    sql`SELECT DISTINCT p.site_id, to_char(p.work_date, 'YYYY-MM-DD') AS d, p.job_id, j.number, j.name, j.status, to_char(j.completed_date, 'YYYY-MM-DD') AS completed
          FROM pulse.production_entries p JOIN pulse.jobs j ON j.id = p.job_id
         WHERE p.org_id = ${ctx.orgId} AND p.deleted_at IS NULL AND p.work_date BETWEEN ${addDays(from, -7)}::date AND ${newest}::date ${siteFilter}`,
  );
  const closed = await closedMonths(db, ctx.orgId);
  const siteName = new Map(sites.map((site) => [site.id, site.name]));
  const keys = new Map<string, { siteId: string; date: string }>();
  for (const row of dayRows) keys.set(`${row.site_id}:${row.d}`, { siteId: row.site_id, date: row.d });
  for (const review of reviews)
    if (siteName.has(review.siteId))
      keys.set(`${review.siteId}:${review.workDate}`, { siteId: review.siteId, date: review.workDate });
  const byDay = new Map(dayRows.map((row) => [`${row.site_id}:${row.d}`, row]));
  const byReview = new Map(reviews.map((review) => [`${review.siteId}:${review.workDate}`, review]));
  const loggedDates = new Map<string, string[]>();
  for (const row of jobDays) {
    const list = loggedDates.get(row.site_id) ?? [];
    if (!list.includes(row.d)) list.push(row.d);
    loggedDates.set(row.site_id, list);
  }
  for (const list of loggedDates.values()) list.sort();

  const ordered = [...keys.values()]
    .filter((key) => siteName.has(key.siteId))
    .sort((a, b) => (a.date === b.date ? a.siteId.localeCompare(b.siteId) : b.date.localeCompare(a.date)));
  return Promise.all(
    ordered.map(async ({ siteId, date }): Promise<DayQueueDTO> => {
      const key = `${siteId}:${date}`;
      const review = byReview.get(key) ?? null;
      const totals = byDay.get(key);
      const approved = review?.status === 'approved';
      const flags = approved ? [] : await dayFlags(ctx, siteId, date);
      const previous = (loggedDates.get(siteId) ?? []).filter((d) => d < date).pop();
      const today = new Set(
        jobDays.filter((row) => row.site_id === siteId && row.d === date).map((row) => row.job_id),
      );
      const missing =
        approved || !previous
          ? []
          : jobDays
              .filter(
                (row) =>
                  row.site_id === siteId &&
                  row.d === previous &&
                  !today.has(row.job_id) &&
                  row.status === 'active' &&
                  (!row.completed || row.completed > date),
              )
              .map((row) => ({ jobId: row.job_id, jobNumber: row.number, jobName: row.name }));
      return {
        siteId,
        siteName: siteName.get(siteId) ?? '',
        date,
        status: review?.status ?? 'not_marked',
        review,
        flags,
        missingJobs: missing,
        entries: totals?.entries ?? 0,
        jobs: totals?.jobs ?? 0,
        unitsGood: totals?.units ?? '0',
        hours: totals?.hours ?? '0',
        locked: closed.has(monthStart(date)),
      };
    }),
  );
});

interface PaceAgg {
  units: number;
  paceHours: number;
  earned: number;
  earnedPaceHours: number;
  days: Set<string>;
}

const emptyAgg = (): PaceAgg => ({ units: 0, paceHours: 0, earned: 0, earnedPaceHours: 0, days: new Set() });

function paceRow(
  key: string,
  label: string,
  sublabel: string | null,
  agg: PaceAgg,
  directTarget?: string | null,
): PaceBoardRowDTO {
  const uph = unitsPerHour(agg.units.toFixed(3), agg.paceHours.toFixed(2));
  // For a mix of jobs the fair target is the pace the same units needed at each job's own target.
  const mixedTarget = agg.earned > 0 ? unitsPerHour(agg.units.toFixed(3), agg.earned.toFixed(2)) : null;
  const target = directTarget !== undefined ? (directTarget ? Number(directTarget) : null) : mixedTarget;
  return {
    key,
    label,
    sublabel,
    unitsGood: agg.units.toFixed(3),
    paceHours: agg.paceHours.toFixed(2),
    uph: uph === null ? null : uph.toFixed(3),
    targetUph: target === null ? null : target.toFixed(3),
    productivityBp:
      directTarget !== undefined
        ? productivityBp(uph, directTarget)
        : agg.earnedPaceHours > 0 && agg.earned > 0
          ? productivityBp(agg.earned.toFixed(3), agg.earnedPaceHours.toFixed(3))
          : null,
    days: agg.days.size,
  };
}

/**
 * Pace against target pace for a date range: by job, by labor class and by day. Only counted
 * hours are used (confirmed hours minus setup hours, SPEC 4.12).
 */
export const getPaceBoard = scoped(async function getPaceBoard(
  ctx: DomainContext,
  filters: { from: string; to: string; siteId?: string | null },
): Promise<PaceBoardDTO> {
  await requirePulse(ctx, 'pulse:read');
  const found = await rows<{
    job_id: string;
    number: string;
    name: string;
    client_id: string;
    client: string;
    job_type_id: string;
    unit_label: string;
    job_target: string | null;
    job_version: number;
    target: string | null;
    class_id: string | null;
    class_name: string | null;
    d: string;
    units: string;
    pace_hours: string;
  }>(
    db,
    sql`SELECT p.job_id, j.number, j.name, j.client_id, c.name AS client, j.job_type_id, j.unit_label, j.standard_uph::text AS job_target, j.version AS job_version,
               COALESCE(st.standard_uph, j.standard_uph)::text AS target, p.labor_class_id AS class_id, lc.name AS class_name,
               to_char(p.work_date, 'YYYY-MM-DD') AS d, sum(p.units_good)::text AS units, sum(p.hours - p.setup_hours)::text AS pace_hours
          FROM pulse.production_entries p
          JOIN pulse.jobs j ON j.id = p.job_id
          JOIN pulse.clients c ON c.id = j.client_id
          LEFT JOIN pulse.job_stats st ON st.job_id = j.id
          LEFT JOIN pulse.labor_classes lc ON lc.id = p.labor_class_id
         WHERE p.org_id = ${ctx.orgId} AND p.deleted_at IS NULL AND j.deleted_at IS NULL AND p.hours_confirmed AND p.source <> 'projects'
           AND p.work_date BETWEEN ${filters.from}::date AND ${filters.to}::date ${filters.siteId ? sql`AND p.site_id = ${filters.siteId}` : sql``}
         GROUP BY p.job_id, j.number, j.name, j.client_id, c.name, j.job_type_id, j.unit_label, j.standard_uph, j.version, st.standard_uph, p.labor_class_id, lc.name, p.work_date`,
  );
  // Units are typed once per job and day (on the first crew line), so pace is worked out per job and day first.
  const jobDay = new Map<string, { units: number; paceHours: number; row: (typeof found)[number] }>();
  for (const row of found) {
    const key = `${row.job_id}:${row.d}`;
    const entry = jobDay.get(key) ?? { units: 0, paceHours: 0, row };
    entry.units += Number(row.units);
    entry.paceHours += Number(row.pace_hours);
    jobDay.set(key, entry);
  }
  const byJob = new Map<string, { agg: PaceAgg; row: (typeof found)[number] }>();
  const byDay = new Map<string, PaceAgg>();
  for (const entry of jobDay.values()) {
    if (entry.paceHours <= 0) continue;
    const job = byJob.get(entry.row.job_id) ?? { agg: emptyAgg(), row: entry.row };
    const day = byDay.get(entry.row.d) ?? emptyAgg();
    for (const agg of [job.agg, day]) {
      agg.units += entry.units;
      agg.paceHours += entry.paceHours;
      agg.days.add(entry.row.d);
      const earned = entry.units > 0 ? earnedHours(entry.units.toFixed(3), entry.row.target) : null;
      if (earned !== null) {
        agg.earned += earned;
        agg.earnedPaceHours += entry.paceHours;
      }
    }
    byJob.set(entry.row.job_id, job);
    byDay.set(entry.row.d, day);
  }
  // By labor class: each class takes the job day's units in proportion to its share of the counted hours.
  const byClass = new Map<string, { agg: PaceAgg; name: string }>();
  for (const row of found) {
    const total = jobDay.get(`${row.job_id}:${row.d}`);
    const hours = Number(row.pace_hours);
    if (!total || total.paceHours <= 0 || hours <= 0) continue;
    const key = row.class_id ?? 'none';
    const entry = byClass.get(key) ?? { agg: emptyAgg(), name: row.class_name ?? 'No labor class' };
    const units = (total.units * hours) / total.paceHours;
    entry.agg.units += units;
    entry.agg.paceHours += hours;
    entry.agg.days.add(row.d);
    const earned = units > 0 ? earnedHours(units.toFixed(3), row.target) : null;
    if (earned !== null) {
      entry.agg.earned += earned;
      entry.agg.earnedPaceHours += hours;
    }
    byClass.set(key, entry);
  }
  const jobRows = [...byJob.values()]
    .map(({ agg, row }) => ({
      ...paceRow(row.job_id, `${row.number} ${row.name}`, row.client, agg, row.target),
      jobId: row.job_id,
      jobTypeId: row.job_type_id,
      clientId: row.client_id,
      jobTargetUph: row.job_target,
      jobVersion: row.job_version,
      unitLabel: row.unit_label,
    }))
    .sort(
      (a, b) => (a.productivityBp ?? Number.MAX_SAFE_INTEGER) - (b.productivityBp ?? Number.MAX_SAFE_INTEGER),
    );
  return {
    from: filters.from,
    to: filters.to,
    byJob: jobRows,
    byClass: [...byClass.entries()]
      .map(([key, entry]) => paceRow(key, entry.name, null, entry.agg))
      .sort((a, b) => Number(b.paceHours) - Number(a.paceHours)),
    byDay: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, agg]) => paceRow(date, shortDate(date), weekdayName(date), agg)),
  };
});

/** "Suggest from history" for every job type at once, next to the target in force today. */
export const suggestAllStandards = scoped(async function suggestAllStandards(ctx: DomainContext): Promise<PaceSuggestionRowDTO[]> {
  await requirePulse(ctx, 'pulse:read');
  const [types, standards, sites] = await Promise.all([
    listJobTypes(ctx),
    listStandards(ctx),
    listSites(ctx),
  ]);
  const today = sites[0]?.today ?? todayInZone('UTC');
  const out: PaceSuggestionRowDTO[] = [];
  for (const type of types) {
    const suggestion = await suggestStandard(ctx, { jobTypeId: type.id });
    const current = standards
      .filter(
        (row) =>
          row.jobTypeId === type.id && !row.clientId && !row.laborClassId && row.effectiveFrom <= today,
      )
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    out.push({
      ...suggestion,
      jobTypeId: type.id,
      jobTypeName: type.name,
      unitLabel: type.unitLabel,
      current: current?.unitsPerLaborHour ?? type.defaultStandardUph ?? null,
    });
  }
  return out;
});
