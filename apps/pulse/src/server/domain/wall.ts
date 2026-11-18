/**
 * The wall display (SPEC section 6, `/wall` and `/wall/t/[token]`): today's units against the
 * goal and the pace against the target, per job, for a TV on the floor.
 *
 * One builder serves both doors. The signed in page passes the person's context; the device link
 * page passes the link it resolved. Money is only read when a signed in person with money rights
 * asks for it. A device link never gets money, whatever its settings say.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { dailyGoal, readPanels, readRotate, wallCall, type WallPanel, type WallStatus } from '@/features/wall/wall-math';
import { addDays, isWorkDay, workDaysBetween } from '@/lib/profit';
import { rows, todayInZone, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { resolveDeviceLink } from './devices';
import { loadSettings } from './settings';

export interface WallJobDTO {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  /** Null when client names are hidden on this screen. */
  readonly clientName: string | null;
  readonly unitLabel: string;
  readonly units: number;
  readonly goal: number | null;
  readonly goalBasis: 'crew' | 'due' | null;
  readonly hours: number;
  readonly people: number;
  readonly uph: number | null;
  readonly targetUph: number | null;
  readonly scoreBp: number | null;
  readonly status: WallStatus;
  readonly reason: 'pace' | 'goal' | 'no_hours' | 'nothing_logged' | 'no_target';
  readonly dueDate: string | null;
  readonly unitsDone: number;
  readonly plannedUnits: number;
  /** Earned that day, in cents. Null unless money is on for this screen. */
  readonly earnedCents: number | null;
}

export interface WallBoardDTO {
  readonly orgName: string;
  readonly siteId: string | null;
  readonly siteName: string;
  readonly today: string;
  /** The day the numbers are for. Equal to `today` unless nothing is logged yet today. */
  readonly date: string;
  readonly jobs: readonly WallJobDTO[];
  readonly totals: { readonly units: number; readonly goal: number | null; readonly hours: number; readonly people: number; readonly jobsLogged: number; readonly jobsActive: number; readonly green: number; readonly amber: number; readonly red: number; readonly earnedCents: number | null };
  readonly dueThisWeek: readonly { readonly id: string; readonly number: string; readonly name: string; readonly clientName: string | null; readonly dueDate: string; readonly unitsDone: number; readonly plannedUnits: number; readonly unitLabel: string }[];
  readonly niceWork: readonly { readonly id: string; readonly number: string; readonly name: string; readonly uph: number; readonly targetUph: number; readonly scoreBp: number }[];
  readonly showMoney: boolean;
  readonly generatedAt: string;
}

export interface WallOptions {
  siteId?: string | null;
  hideClientNames?: boolean;
  showMoney?: boolean;
}

interface WallJobRow {
  id: string;
  number: string;
  name: string;
  client_name: string;
  unit_label: string;
  planned_units: string;
  due_date: string | null;
  usual_crew: { headcount?: number }[] | null;
  standard_uph: string | null;
  units_done: string;
  units: string | null;
  hours: string | null;
  pace_hours: string | null;
  people: string | null;
  earned: string | null;
}

async function buildBoard(orgId: string, options: WallOptions & { showMoney: boolean }): Promise<WallBoardDTO> {
  const settings = await loadSettings(orgId);
  const [org] = await rows<{ name: string }>(db, sql`SELECT name FROM core.organization WHERE id = ${orgId}`);
  const [site] = options.siteId ? await rows<{ id: string; name: string; timezone: string }>(db, sql`SELECT id, name, timezone FROM pulse.sites WHERE org_id = ${orgId} AND id = ${options.siteId} AND deleted_at IS NULL`) : [];
  const today = todayInZone(site?.timezone ?? settings.timezone);
  const siteFilter = site ? sql`AND p.site_id = ${site.id}` : sql``;
  const [latest] = await rows<{ d: string | null }>(db, sql`SELECT to_char(max(p.work_date), 'YYYY-MM-DD') AS d FROM pulse.production_entries p WHERE p.org_id = ${orgId} AND p.deleted_at IS NULL AND p.work_date <= ${today}::date AND p.work_date > ${today}::date - 7 ${siteFilter}`);
  const date = latest?.d ?? today;
  const found = await rows<WallJobRow>(
    db,
    sql`SELECT j.id, j.number, j.name, c.name AS client_name, j.unit_label, j.planned_units::text, to_char(j.due_date, 'YYYY-MM-DD') AS due_date, j.usual_crew,
               COALESCE(st.standard_uph, j.standard_uph)::text AS standard_uph, COALESCE(st.units_good, 0)::text AS units_done,
               d.units::text, d.hours::text, d.pace_hours::text, d.people::text,
               ${options.showMoney ? sql`(SELECT sum(f.amount_cents) FROM pulse.fact_days f WHERE f.org_id = j.org_id AND f.job_id = j.id AND f.work_date = ${date}::date AND f.kind LIKE 'revenue%')::text` : sql`NULL::text`} AS earned
          FROM pulse.jobs j
          JOIN pulse.clients c ON c.id = j.client_id
          LEFT JOIN pulse.job_stats st ON st.job_id = j.id
          LEFT JOIN LATERAL (
            SELECT sum(p.units_good) AS units, sum(p.hours) AS hours, sum(p.hours - p.setup_hours) AS pace_hours, sum(COALESCE(p.headcount, 0)) AS people
              FROM pulse.production_entries p WHERE p.job_id = j.id AND p.org_id = j.org_id AND p.deleted_at IS NULL AND p.work_date = ${date}::date
          ) d ON true
         WHERE j.org_id = ${orgId} AND j.deleted_at IS NULL AND j.archived_at IS NULL
           AND (j.status = 'active' OR d.units IS NOT NULL) ${site ? sql`AND j.site_id = ${site.id}` : sql``}
         ORDER BY (d.units IS NULL), j.due_date NULLS LAST, j.number`,
  );
  const shift = Number(settings.defaultShiftHours) || 8;
  const dayIsOver = date < today;
  const jobs: WallJobDTO[] = found.map((row) => {
    const crew = (row.usual_crew ?? []).reduce((sum, line) => sum + (Number(line.headcount) || 0), 0);
    const target = row.standard_uph === null ? null : Number(row.standard_uph);
    const planned = Number(row.planned_units);
    const done = Number(row.units_done);
    const units = Number(row.units ?? 0);
    // Units left before this day's work, so the goal does not shrink as the day goes.
    const left = planned > 0 ? Math.max(0, planned - (done - units)) : null;
    const daysLeft = row.due_date && row.due_date >= date ? workDaysBetween(date, row.due_date, settings.workingDays) + (isWorkDay(date, settings.workingDays) ? 1 : 0) : null;
    const goal = dailyGoal({ crew, shiftHours: shift, targetUph: target, unitsLeft: left, workDaysLeft: daysLeft });
    const call = wallCall({ units, paceHours: Number(row.pace_hours ?? 0), targetUph: target, goalUnits: goal?.units ?? null, dayIsOver, watchBp: settings.productivityWatchBp, riskBp: settings.productivityRiskBp });
    return {
      id: row.id,
      number: row.number,
      name: row.name,
      clientName: options.hideClientNames ? null : row.client_name,
      unitLabel: row.unit_label,
      units,
      goal: goal?.units ?? null,
      goalBasis: goal?.basis ?? null,
      hours: Number(row.hours ?? 0),
      people: Number(row.people ?? 0),
      uph: call.uph,
      targetUph: target,
      scoreBp: call.scoreBp,
      status: call.status,
      reason: call.reason,
      dueDate: row.due_date,
      unitsDone: done,
      plannedUnits: planned,
      earnedCents: options.showMoney && row.earned !== null ? Number(row.earned) : options.showMoney ? 0 : null,
    };
  });
  const logged = jobs.filter((job) => job.units > 0 || job.hours > 0);
  const withGoal = logged.filter((job) => job.goal !== null);
  const weekEnd = addDays(today, 7);
  return {
    orgName: org?.name ?? 'KitStak Pulse',
    siteId: site?.id ?? null,
    siteName: site?.name ?? 'All sites',
    today,
    date,
    jobs,
    totals: {
      units: logged.reduce((sum, job) => sum + job.units, 0),
      goal: withGoal.length > 0 ? withGoal.reduce((sum, job) => sum + (job.goal ?? 0), 0) : null,
      hours: Math.round(logged.reduce((sum, job) => sum + job.hours, 0) * 100) / 100,
      people: Math.round(logged.reduce((sum, job) => sum + job.people, 0) * 100) / 100,
      jobsLogged: logged.length,
      jobsActive: jobs.length,
      green: jobs.filter((job) => job.status === 'green').length,
      amber: jobs.filter((job) => job.status === 'amber').length,
      red: jobs.filter((job) => job.status === 'red').length,
      earnedCents: options.showMoney ? jobs.reduce((sum, job) => sum + (job.earnedCents ?? 0), 0) : null,
    },
    dueThisWeek: jobs
      .filter((job) => job.dueDate !== null && job.dueDate >= today && job.dueDate <= weekEnd && (job.plannedUnits <= 0 || job.unitsDone < job.plannedUnits))
      .sort((a, b) => ((a.dueDate ?? '') < (b.dueDate ?? '') ? -1 : 1))
      .slice(0, 8)
      .map((job) => ({ id: job.id, number: job.number, name: job.name, clientName: job.clientName, dueDate: job.dueDate as string, unitsDone: job.unitsDone, plannedUnits: job.plannedUnits, unitLabel: job.unitLabel })),
    // Only jobs whose pace could be read from real hours make this list, so a job with missing hours never does.
    niceWork: jobs
      .filter((job) => job.reason === 'pace' && job.uph !== null && job.targetUph !== null && job.scoreBp !== null && job.scoreBp >= 10000)
      .sort((a, b) => (b.scoreBp ?? 0) - (a.scoreBp ?? 0))
      .slice(0, 5)
      .map((job) => ({ id: job.id, number: job.number, name: job.name, uph: job.uph as number, targetUph: job.targetUph as number, scoreBp: job.scoreBp as number })),
    showMoney: options.showMoney,
    generatedAt: new Date().toISOString(),
  };
}

/** The wall for a signed in person. Money shows only when asked for and only to a money role. */
export async function getWallBoard(ctx: DomainContext, options: WallOptions = {}): Promise<WallBoardDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  return buildBoard(ctx.orgId, { ...options, showMoney: Boolean(options.showMoney) && access.seesMoney });
}

export interface WallDeviceDTO {
  readonly board: WallBoardDTO;
  readonly rotateSeconds: number;
  readonly panels: readonly WallPanel[];
  readonly linkName: string;
}

const hits = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 40;

/** A small in memory limit per link: a wall refreshes once a minute, so 40 loads a minute is plenty. */
function allow(key: string, now = Date.now()): boolean {
  const entry = hits.get(key);
  if (!entry || entry.reset <= now) {
    if (hits.size > 5000) hits.clear();
    hits.set(key, { count: 1, reset: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_PER_WINDOW;
}

/**
 * The wall behind a device link, for a TV with no login. Returns `null` for an unknown, expired
 * or turned off link, and `'busy'` when the link is being loaded far too often. Never money.
 */
export async function getWallForDevice(token: string): Promise<WallDeviceDTO | 'busy' | null> {
  const device = await resolveDeviceLink(token, 'wall');
  if (!device) return null;
  if (!allow(device.link.id)) return 'busy';
  const config = (device.link.config ?? {}) as { rotateSeconds?: unknown; panels?: unknown; hideClientNames?: unknown; allSites?: unknown };
  const board = await buildBoard(device.link.orgId, { siteId: config.allSites === true ? null : device.site.id, hideClientNames: config.hideClientNames === true, showMoney: false });
  return { board, rotateSeconds: readRotate(config.rotateSeconds), panels: readPanels(config.panels), linkName: device.link.name };
}
