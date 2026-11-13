/**
 * Labor Analytics (KitStaks-designed, BUILD_PLAN Part D): 5 native dashboards built from
 * completed tasks and receipts. Task time = finish − start when the scanner recorded a
 * start; otherwise the gap since the associate's previous task that day (capped at 30
 * min, floored at 15 s), the usual "time between scans" labor method.
 */
import { sql } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import type { AnalyticsChart, AnalyticsKpi, AnalyticsRow, LaborPage, TimingShare } from './analytics-types';
import { TASK_TYPES_BY_KIND } from '@/lib/grid-defs/jobs/tasks';
import { RECEIPT_GRID_FIELDS } from '@/lib/grid-defs/receiving/receiving-history';
import {
  clIn,
  dayFilter,
  daySql,
  fmtInt,
  localDayOf,
  median,
  PALETTE,
  rangeFilter,
  round,
  whIn,
  type Range,
} from './analytics-common';
import { dbAll } from '@/server/db/sql';

export const MAX_GAP_MINUTES = 30;
export const RECEIVING_GRID = '/receiving/history';
/** Receiving History filters by receiving user once M05 exposes the field (RA-R3-5). */
const RECEIVING_HAS_USER_FILTER = RECEIPT_GRID_FIELDS.some((f) => f.field === 'receivedBy');
/** `&f.warehouseId=in:…` so receiving drilldowns keep the dashboard's warehouse filter. */
export const warehouseQs = (wh: readonly string[]): string =>
  wh.length ? `&f.warehouseId=in:${wh.map(encodeURIComponent).join(',')}` : '';
/**
 * One receiver's receipts in the range. Receiving History is used when it can filter by
 * user; until then the drill opens the User Performance Report for that user and period
 * (its Received Item Quantity is the same receipts, per day).
 */
export function receiverHref(
  r: Pick<Range, 'fromIso' | 'toIso' | 'from' | 'to' | 'clientIds'>,
  wh: readonly string[],
  user: string,
  hasUserFilter = RECEIVING_HAS_USER_FILTER,
): string {
  const u = encodeURIComponent(user);
  return hasUserFilter
    ? `${RECEIVING_GRID}?${rangeFilter('receivedAt', r)}${clientQs(r)}${warehouseQs(wh)}&f.receivedBy=eq:${u}`
    : `/reports/user-performance?f.activityDate=date:custom:${r.from}..${r.to}${warehouseQs(wh)}&f.user=eq:${u}`;
}
export const MIN_TASK_MINUTES = 0.25;
/** Associates with fewer completed tasks are "Low sample": plotted, but kept out of the medians and quadrants. */
export const MIN_QUADRANT_TASKS = 20;

export interface TaskFact {
  readonly id: string;
  readonly type: string;
  readonly userId: string;
  readonly user: string;
  readonly day: string;
  readonly qty: number;
  readonly mins: number;
  /** False when the task had no start scan and no earlier task that day (no duration evidence). */
  readonly measured: boolean;
  /** Where the duration came from: start → finish scans, the gap since the previous task, or nothing. */
  readonly timing: TaskTiming;
}

export type TaskTiming = 'timed' | 'inferred' | 'none';

export function taskTiming(
  startedAt: string | null,
  finishedAt: string,
  prevFinishedAt: string | null,
): TaskTiming {
  const fin = Date.parse(finishedAt);
  const start = startedAt ? Date.parse(startedAt) : NaN;
  if (Number.isFinite(start) && fin > start) return 'timed';
  return prevFinishedAt ? 'inferred' : 'none';
}

/** Share of tasks per timing source (shown on every labor page). */
export function timingShare(facts: readonly Pick<TaskFact, 'timing'>[]): TimingShare {
  let timed = 0;
  let inferred = 0;
  let none = 0;
  for (const f of facts) {
    if (f.timing === 'timed') timed += 1;
    else if (f.timing === 'inferred') inferred += 1;
    else none += 1;
  }
  return { total: facts.length, timed, inferred, none };
}

/**
 * Task minutes from explicit start/finish, else the gap since the previous finish. The same
 * sanity window (15 s .. 30 min) applies to every task type, so one long-running scan (e.g. a
 * kitting task left open for 3 h) cannot dominate the averages.
 */
export function taskMinutes(
  startedAt: string | null,
  finishedAt: string,
  prevFinishedAt: string | null,
): number | null {
  const fin = Date.parse(finishedAt);
  const start = startedAt ? Date.parse(startedAt) : NaN;
  if (Number.isFinite(start) && fin > start)
    return Math.min(Math.max((fin - start) / 60_000, MIN_TASK_MINUTES), MAX_GAP_MINUTES);
  if (prevFinishedAt) {
    const gap = (fin - Date.parse(prevFinishedAt)) / 60_000;
    return Math.min(Math.max(gap, MIN_TASK_MINUTES), MAX_GAP_MINUTES);
  }
  return null;
}

export async function loadTaskFacts(db: AppDb, r: Range, wh: readonly string[]): Promise<TaskFact[]> {
  const rows = await dbAll<{
    id: string;
    type: string;
    uid: string;
    user: string;
    started: string | null;
    fin: string;
    prev: string | null;
    qty: number;
  }>(
    db,
    sql`
    SELECT t.id, t.task_type AS type, t.executed_by_user_id AS uid, u.name AS user, t.started_at AS started, t.finished_at AS fin,
           LAG(t.finished_at) OVER (PARTITION BY t.executed_by_user_id, ${daySql('t.finished_at', r)} ORDER BY t.finished_at) AS prev,
           COALESCE(t.actual_qty, t.planned_qty, 0) AS qty
    FROM tasks t JOIN users u ON u.id = t.executed_by_user_id
    WHERE t.status = 'Completed' AND t.finished_at >= ${r.fromIso} AND t.finished_at < ${r.toIso} AND ${whIn('t.warehouse_id', wh)} AND ${clIn('t.client_id', r)}`,
  );
  return rows.map((x) => {
    const m = taskMinutes(x.started, x.fin, x.prev);
    return {
      id: x.id,
      type: x.type,
      userId: x.uid,
      user: x.user,
      day: localDayOf(x.fin, r),
      qty: Number(x.qty),
      mins: m ?? 0,
      measured: m !== null,
      timing: taskTiming(x.started, x.fin, x.prev),
    };
  });
}

export const TASKS_GRID = '/tasks/order-operations';
/** Count and Replenishment tasks live on their own Task Details tabs. */
const KIND_GRID: Readonly<Record<string, string>> = Object.fromEntries([
  ...TASK_TYPES_BY_KIND.count.map((t) => [t, '/tasks/count'] as const),
  ...TASK_TYPES_BY_KIND.replenishment.map((t) => [t, '/tasks/replenishment'] as const),
]);
/** Fixed, distinct colour per task type, so a type keeps its colour across every chart. */
export const TASK_TYPE_COLORS: Readonly<Record<string, string>> = {
  Picking: '#2E5CE6',
  Packing: '#17874D',
  Loading: '#E8710A',
  Sorting: '#00A3BF',
  Kitting: '#8E24AA',
  Count: '#C2412A',
  Replenishment: '#B07F00',
};
export const colorOfType = (t: string, i: number): string =>
  TASK_TYPE_COLORS[t] ?? (PALETTE[(i + 3) % PALETTE.length] as string);
/** "Picking, Packing, Loading +3 more" */
export const typesHint = (types: readonly string[], shown = 3): string | undefined =>
  types.length === 0
    ? undefined
    : types.length <= shown + 1
      ? types.join(', ')
      : `${types.slice(0, shown).join(', ')} +${types.length - shown} more`;
export const taskGridOf = (types: readonly string[]): string => {
  const grids = new Set(types.map((t) => KIND_GRID[t] ?? TASKS_GRID));
  return grids.size === 1 ? ([...grids][0] as string) : TASKS_GRID;
};
/** `&f.clientId=in:a,b` when the dashboard has a client filter. */
export const clientQs = (r: Pick<Range, 'clientIds'>): string =>
  r.clientIds.length ? `&f.clientId=in:${r.clientIds.map(encodeURIComponent).join(',')}` : '';
/** `&f.executedBy=eq:<me>` in self-only mode, unless the link already names an associate. */
const selfQs = (r: Pick<Range, 'executedBy'>, extra: string): string =>
  r.executedBy && !extra.includes('f.executedBy=')
    ? `&f.executedBy=eq:${encodeURIComponent(r.executedBy)}`
    : '';
export const tasksHref = (r: Range, extra: string, grid: string = TASKS_GRID) =>
  `${grid}?f.status=in:Completed&${rangeFilter('finishedAt', r)}${clientQs(r)}${selfQs(r, extra)}${extra}`;
/** Completed tasks finished on one day (the line charts' per-day drilldown). */
/** Drilldown for one task type, scoped to the tab that lists it so the grid total matches. */
export const typeHref = (r: Range, type: string, extra = '') =>
  tasksHref(r, `&f.taskType=in:${encodeURIComponent(type)}${extra}`, taskGridOf([type]));
export const tasksDayHref = (r: Range, day: string, extra = '') =>
  `${TASKS_GRID}?f.status=in:Completed&${dayFilter('finishedAt', day, r)}${clientQs(r)}${selfQs(r, extra)}${extra}`;
const enc = encodeURIComponent;

interface UserAgg {
  userId: string;
  user: string;
  tasks: number;
  measured: number;
  units: number;
  mins: number;
  byType: Map<string, number>;
  byDay: Map<string, number>;
}

export function aggregateUsers(facts: readonly TaskFact[]): UserAgg[] {
  const m = new Map<string, UserAgg>();
  for (const f of facts) {
    const a = m.get(f.userId) ?? {
      userId: f.userId,
      user: f.user,
      tasks: 0,
      measured: 0,
      units: 0,
      mins: 0,
      byType: new Map(),
      byDay: new Map(),
    };
    a.tasks += 1;
    a.units += f.qty;
    a.mins += f.mins;
    if (f.measured) a.measured += 1;
    a.byType.set(f.type, (a.byType.get(f.type) ?? 0) + 1);
    a.byDay.set(f.day, (a.byDay.get(f.day) ?? 0) + 1);
    m.set(f.userId, a);
  }
  return [...m.values()].sort((a, b) => b.tasks - a.tasks);
}

/**
 * "Order ops 1,302 · Count 14 · Replenishment 18": completed tasks per Task Details tab, so a
 * KPI that spans several tabs states what each tab's drilldown will show.
 */
export function kindBreakdown(facts: readonly TaskFact[]): string | undefined {
  const by = new Map<string, number>();
  for (const f of facts) {
    const g =
      KIND_GRID[f.type] === '/tasks/count'
        ? 'Count'
        : KIND_GRID[f.type] === '/tasks/replenishment'
          ? 'Replenishment'
          : 'Order ops';
    by.set(g, (by.get(g) ?? 0) + 1);
  }
  return by.size > 1 ? [...by.entries()].map(([g, n]) => `${g} ${fmtInt(n)}`).join(' · ') : undefined;
}
const measuredOf = (facts: readonly TaskFact[]) => facts.filter((f) => f.measured);
/** A task type is flagged when at least this share of its timed tasks sits on the cap. */
export const CAP_FLAG_SHARE = 0.5;
/** Share of timed tasks whose duration was clipped to MAX_GAP_MINUTES. */
export const capShare = (timed: readonly Pick<TaskFact, 'mins'>[]): number =>
  timed.length ? timed.filter((f) => f.mins >= MAX_GAP_MINUTES).length / timed.length : 0;

/** Tasks per hour of measured task time. */
export const speedOf = (tasks: number, mins: number): number =>
  mins > 0 ? round(tasks / (mins / 60), 1) : 0;

function typesOf(facts: readonly TaskFact[]): string[] {
  const counts = new Map<string, number>();
  for (const f of facts) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

function averageTask(
  facts: readonly TaskFact[],
  r: Range,
): { kpis: AnalyticsKpi[]; charts: AnalyticsChart[] } {
  const types = typesOf(facts);
  const series = types.map((t, i) => ({ key: t, label: t, color: colorOfType(t, i) }));
  const trend: AnalyticsRow[] = r.days.map((day) => {
    const row: Record<string, string | number | null> = { day };
    let all = 0;
    let n = 0;
    for (const t of types) {
      const xs = facts.filter((f) => f.measured && f.day === day && f.type === t);
      row[t] = xs.length ? round(xs.reduce((a, f) => a + f.mins, 0) / xs.length, 2) : null;
      all += xs.reduce((a, f) => a + f.mins, 0);
      n += xs.length;
    }
    row.overall = n ? round(all / n, 2) : null;
    row.tasks = n;
    row.href = tasksDayHref(r, day);
    return row;
  });
  const byType: AnalyticsRow[] = types.map((t) => {
    const all = facts.filter((f) => f.type === t);
    const xs = measuredOf(all);
    const mins = xs.reduce((a, f) => a + f.mins, 0);
    const atCap = capShare(xs);
    return {
      type: t,
      tasks: all.length,
      avgMinutes: round(mins / Math.max(xs.length, 1), 2),
      totalHours: round(mins / 60, 1),
      atCapPct: round(atCap * 100, 0),
      timing:
        atCap >= CAP_FLAG_SHARE
          ? `${round(atCap * 100, 0)}% of tasks hit the ${MAX_GAP_MINUTES} min cap: the real average is higher`
          : 'Measured',
      color: colorOfType(t, types.indexOf(t)),
      href: typeHref(r, t),
    };
  });
  const capped = byType.filter((x) => x.timing !== 'Measured').map((x) => String(x.type));
  const measured = measuredOf(facts);
  const totalMins = measured.reduce((a, f) => a + f.mins, 0);
  return {
    kpis: [
      {
        label: 'Tasks completed',
        value: fmtInt(facts.length),
        hint: kindBreakdown(facts),
        href: tasksHref(r, ''),
      },
      {
        label: 'Average task time',
        value: `${round(totalMins / Math.max(measured.length, 1), 2)} min`,
        hint: `Across ${fmtInt(measured.length)} timed tasks (each capped at ${MAX_GAP_MINUTES} min)`,
        href: tasksHref(r, ''),
      },
      {
        label: 'Measured hours',
        value: `${round(totalMins / 60, 1)} h`,
        hint: 'Sum of timed task durations (start to finish)',
        href: tasksHref(r, ''),
      },
      { label: 'Task types', value: String(types.length), hint: typesHint(types), href: tasksHref(r, '') },
    ],
    charts: [
      {
        id: 'trend',
        title: 'Average task time by day',
        description:
          'Average minutes per task, per task type, with the overall trend line. Days without tasks leave a gap in every line, the trend included. Click a day to open its tasks.',
        kind: 'line',
        xKey: 'day',
        wide: true,
        breakOnNull: true,
        series: [...series, { key: 'overall', label: 'All tasks (trend)', color: '#1C2333' }],
        rows: trend,
        hrefKey: 'href',
        columns: [
          { key: 'day', label: 'Day' },
          ...types.map((t) => ({ key: t, label: `${t} (min)`, kind: 'minutes' as const })),
          { key: 'overall', label: 'All tasks (min)', kind: 'minutes' },
          { key: 'tasks', label: 'Tasks', kind: 'number' },
        ],
        gridHref: tasksHref(r, ''),
        gridLabel: 'Open completed tasks',
      },
      {
        id: 'by-type',
        title: 'Average by task type',
        description: `Average minutes per task over the whole period.${capped.length ? ` ${capped.join(', ')}: most tasks hit the ${MAX_GAP_MINUTES} min cap (hatched), so the real average is higher.` : ''} Click a bar to open those tasks.`,
        kind: 'bar',
        xKey: 'type',
        wide: true,
        flagKey: 'timing',
        flagNormal: 'Measured',
        series: [{ key: 'avgMinutes', label: 'Avg minutes', color: PALETTE[0] }],
        rows: byType,
        hrefKey: 'href',
        colorKey: 'color',
        columns: [
          { key: 'type', label: 'Task type' },
          { key: 'tasks', label: 'Tasks', kind: 'number' },
          { key: 'avgMinutes', label: 'Avg minutes', kind: 'minutes' },
          { key: 'totalHours', label: 'Total hours', kind: 'hours' },
          { key: 'atCapPct', label: `At ${MAX_GAP_MINUTES} min cap`, kind: 'percent' },
          { key: 'timing', label: 'Timing' },
        ],
        gridHref: tasksHref(r, ''),
        gridLabel: 'Open completed tasks',
      },
    ],
  };
}

function associateTask(
  facts: readonly TaskFact[],
  r: Range,
): { kpis: AnalyticsKpi[]; charts: AnalyticsChart[] } {
  const types = typesOf(facts);
  const users = aggregateUsers(facts);
  const rows: AnalyticsRow[] = users.map((u) => {
    const row: Record<string, string | number | null> = {
      user: u.user,
      total: u.tasks,
      href: tasksHref(r, `&f.executedBy=eq:${enc(u.user)}`),
    };
    for (const t of types) row[t] = u.byType.get(t) ?? 0;
    return row;
  });
  return {
    kpis: [
      {
        label: 'Associates',
        value: String(users.length),
        hint: 'Completed at least one task',
        href: tasksHref(r, ''),
      },
      {
        label: 'Tasks completed',
        value: fmtInt(facts.length),
        hint: kindBreakdown(facts),
        href: tasksHref(r, ''),
      },
      {
        label: 'Tasks per associate',
        value: fmtInt(facts.length / Math.max(users.length, 1)),
        hint: 'Tasks completed ÷ associates',
        href: tasksHref(r, ''),
      },
      {
        label: 'Top associate',
        value: users[0]?.user ?? 'None',
        hint: users[0] ? `${fmtInt(users[0].tasks)} tasks` : 'No completed tasks yet',
        href: users[0] ? tasksHref(r, `&f.executedBy=eq:${enc(users[0].user)}`) : undefined,
      },
    ],
    charts: [
      {
        id: 'per-user',
        title: 'Tasks per associate by type',
        description: 'Stacked by task type. Click an associate to open their tasks.',
        kind: 'stackedBar',
        xKey: 'user',
        wide: true,
        series: types.map((t, i) => ({ key: t, label: t, color: colorOfType(t, i) })),
        rows,
        hrefKey: 'href',
        columns: [
          { key: 'user', label: 'Associate' },
          ...types.map((t) => ({ key: t, label: t, kind: 'number' as const })),
          { key: 'total', label: 'Total', kind: 'number' },
        ],
        gridHref: tasksHref(r, ''),
        gridLabel: 'Open completed tasks',
      },
    ],
  };
}

export const QUADRANT_LABELS = [
  'Top performers',
  'Fast, low volume',
  'High volume, slower',
  'Needs coaching',
] as const;
export const LOW_SAMPLE = 'Low sample';

export function quadrantOf(speed: number, volume: number, med: { x: number; y: number }): string {
  if (volume >= med.x && speed >= med.y) return QUADRANT_LABELS[0];
  if (volume < med.x && speed >= med.y) return QUADRANT_LABELS[1];
  if (volume >= med.x) return QUADRANT_LABELS[2];
  return QUADRANT_LABELS[3];
}

/**
 * Quadrant points. Speed is tasks per measured hour; associates under MIN_QUADRANT_TASKS are
 * "Low sample": still listed, but kept out of the medians and of every quadrant (a handful
 * of quick scans would otherwise read as the fastest associate and stretch the axis).
 */
export function quadrantPoints(facts: readonly TaskFact[], minTasks = MIN_QUADRANT_TASKS) {
  const users = aggregateUsers(facts);
  const points = users.map((u) => ({
    userId: u.userId,
    user: u.user,
    volume: u.tasks,
    speed: speedOf(u.measured, u.mins),
    lowSample: u.tasks < minTasks,
  }));
  const ranked = points.filter((p) => !p.lowSample);
  const med = { x: median(ranked.map((p) => p.volume)), y: round(median(ranked.map((p) => p.speed)), 1) };
  return {
    med,
    points: points.map((p) => ({
      userId: p.userId,
      user: p.user,
      volume: p.volume,
      speed: p.speed,
      quadrant: p.lowSample ? LOW_SAMPLE : quadrantOf(p.speed, p.volume, med),
    })),
  };
}

function quadrant(
  facts: readonly TaskFact[],
  r: Range,
  self: SelfScope | null,
): { kpis: AnalyticsKpi[]; charts: AnalyticsChart[] } {
  // Medians always come from the whole team; in self-only mode only the viewer's own dot is returned.
  const { med, points } = quadrantPoints(facts);
  const mine = self ? points.filter((p) => p.userId === self.id) : points;
  const rows: AnalyticsRow[] = mine.map((p) => ({
    user: p.user,
    volume: p.volume,
    speed: p.speed,
    quadrant: p.quadrant,
    href: tasksHref(r, `&f.executedBy=eq:${enc(p.user)}`),
  }));
  if (self) {
    const me = rows[0];
    return {
      kpis: [
        {
          label: 'Team median volume',
          value: `${fmtInt(med.x)} tasks`,
          hint: 'Middle associate by tasks completed',
          href: tasksHref(r, ''),
        },
        {
          label: 'Team median speed',
          value: `${med.y} tasks/h`,
          hint: 'Middle associate by tasks per measured hour',
        },
        {
          label: 'Your volume',
          value: me ? `${fmtInt(Number(me.volume))} tasks` : 'None',
          hint: 'Tasks you completed in the period',
          href: tasksHref(r, ''),
        },
        {
          label: 'Your quadrant',
          value: me ? String(me.quadrant) : 'No tasks yet',
          hint: me ? `${String(me.speed)} tasks/h` : 'Complete a task to be placed',
        },
      ],
      charts: [
        {
          id: 'quadrant',
          title: 'Your speed vs volume',
          description: 'Your dot against the team medians (dashed lines).',
          kind: 'scatter',
          xKey: 'volume',
          yKey: 'speed',
          wide: true,
          series: [{ key: 'speed', label: 'You', color: PALETTE[0] }],
          rows,
          hrefKey: 'href',
          medians: med,
          quadrants: [...QUADRANT_LABELS] as unknown as readonly [string, string, string, string],
          columns: [
            { key: 'user', label: 'Associate' },
            { key: 'volume', label: 'Tasks completed', kind: 'number' },
            { key: 'speed', label: 'Tasks per hour', kind: 'decimal' },
            { key: 'quadrant', label: 'Quadrant' },
          ],
        },
      ],
    };
  }
  const usersIn = (q: string) => rows.filter((x) => x.quadrant === q).map((x) => String(x.user));
  const groupHref = (names: readonly string[]) =>
    names.length ? tasksHref(r, `&f.executedBy=in:${names.map(enc).join(',')}`) : undefined;
  const low = usersIn(LOW_SAMPLE);
  return {
    kpis: [
      {
        label: 'Median volume',
        value: `${fmtInt(med.x)} tasks`,
        hint: `${rows.length - low.length} ranked associates${low.length ? ` · ${low.length} low sample` : ''}`,
        href: tasksHref(r, ''),
      },
      {
        label: 'Median speed',
        value: `${med.y} tasks/h`,
        hint: 'Middle associate by tasks per measured hour',
        href: tasksHref(r, ''),
      },
      {
        label: 'Top performers',
        value: String(usersIn(QUADRANT_LABELS[0]).length),
        hint: usersIn(QUADRANT_LABELS[0]).slice(0, 3).join(', ') || 'Above both medians',
        href: groupHref(usersIn(QUADRANT_LABELS[0])),
      },
      {
        label: 'Needs coaching',
        value: String(usersIn(QUADRANT_LABELS[3]).length),
        hint: usersIn(QUADRANT_LABELS[3]).slice(0, 3).join(', ') || 'Below both medians',
        href: groupHref(usersIn(QUADRANT_LABELS[3])),
      },
    ],
    charts: [
      {
        id: 'quadrant',
        title: 'Speed vs volume',
        description: `Each dot is an associate, coloured by quadrant. Dashed lines are the team medians. Associates with fewer than ${MIN_QUADRANT_TASKS} tasks are grey (low sample) and not ranked.`,
        kind: 'scatter',
        xKey: 'volume',
        yKey: 'speed',
        wide: true,
        series: [{ key: 'speed', label: 'Associates', color: PALETTE[0] }],
        rows,
        hrefKey: 'href',
        medians: med,
        quadrants: [...QUADRANT_LABELS] as unknown as readonly [string, string, string, string],
        columns: [
          { key: 'user', label: 'Associate' },
          { key: 'volume', label: 'Tasks completed', kind: 'number' },
          { key: 'speed', label: 'Tasks per hour', kind: 'decimal' },
          { key: 'quadrant', label: 'Quadrant' },
        ],
      },
    ],
  };
}

function bestSpeedKpi(rows: readonly AnalyticsRow[]): AnalyticsKpi {
  const best = rows
    .filter((x) => Number(x.tasks) >= MIN_QUADRANT_TASKS)
    .sort((a, b) => Number(b.speed) - Number(a.speed))[0];
  return best
    ? {
        label: 'Best speed',
        value: `${best.speed} tasks/h`,
        hint: `${String(best.user)} (min. ${MIN_QUADRANT_TASKS} tasks)`,
        href: String(best.href),
      }
    : { label: 'Best speed', value: 'None', hint: `Needs an associate with ${MIN_QUADRANT_TASKS}+ tasks` };
}

/** "Picking:12,Packing:3" (most first): the per-type split behind an associate's detail view. */
export const byTypeOf = (u: { byType: ReadonlyMap<string, number> }): string =>
  [...u.byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t}:${n}`)
    .join(',');

function associates(
  facts: readonly TaskFact[],
  r: Range,
  self: SelfScope | null,
): { kpis: AnalyticsKpi[]; charts: AnalyticsChart[] } {
  const users = aggregateUsers(facts);
  if (self) {
    // Rank among the whole team, but only the viewer's own scorecard leaves the server.
    const idx = users.findIndex((u) => u.userId === self.id);
    const u = users[idx];
    const row: AnalyticsRow | null = u
      ? {
          rank: idx + 1,
          user: u.user,
          tasks: u.tasks,
          units: u.units,
          speed: speedOf(u.measured, u.mins),
          avgMinutes: round(u.mins / Math.max(u.measured, 1), 2),
          hours: round(u.mins / 60, 1),
          activeDays: u.byDay.size,
          spark: r.days.map((d) => u.byDay.get(d) ?? 0).join(','),
          sparkDays: r.days.join(','),
          byType: byTypeOf(u),
          href: tasksHref(r, ''),
        }
      : null;
    return {
      kpis: [
        { label: 'Your rank', value: u ? `#${idx + 1} of ${users.length}` : 'None', hint: 'By tasks completed' },
        {
          label: 'Your tasks',
          value: u ? fmtInt(u.tasks) : '0',
          hint: 'Tasks you completed in the period',
          href: tasksHref(r, ''),
        },
        {
          label: 'Your speed',
          value: u ? `${speedOf(u.measured, u.mins)} tasks/h` : 'None',
          hint: 'Timed tasks per measured hour',
          href: tasksHref(r, ''),
        },
        {
          label: 'Team speed',
          value: `${speedOf(
            measuredOf(facts).length,
            facts.reduce((a, f) => a + f.mins, 0),
          )} tasks/h`,
          hint: 'Whole team, timed tasks per measured hour',
        },
      ],
      charts: [
        {
          id: 'scorecards',
          title: 'Your scorecard',
          description:
            'Your rank is among every associate in the selection. The sparkline shows your tasks per day.',
          kind: 'scorecards',
          xKey: 'user',
          wide: true,
          series: [{ key: 'tasks', label: 'Tasks', color: PALETTE[0] }],
          rows: row ? [row] : [],
          hrefKey: 'href',
          columns: [
            { key: 'rank', label: 'Rank', kind: 'number' },
            { key: 'user', label: 'Associate' },
            { key: 'tasks', label: 'Tasks', kind: 'number' },
            { key: 'units', label: 'Units', kind: 'number' },
            { key: 'speed', label: 'Tasks per hour', kind: 'decimal' },
            { key: 'avgMinutes', label: 'Avg task (min)', kind: 'minutes' },
            { key: 'hours', label: 'Hours', kind: 'hours' },
            { key: 'activeDays', label: 'Active days', kind: 'number' },
          ],
        },
      ],
    };
  }
  const rows: AnalyticsRow[] = users.map((u, i) => ({
    rank: i + 1,
    user: u.user,
    tasks: u.tasks,
    units: u.units,
    speed: speedOf(u.measured, u.mins),
    avgMinutes: round(u.mins / Math.max(u.measured, 1), 2),
    hours: round(u.mins / 60, 1),
    activeDays: u.byDay.size,
    spark: r.days.map((d) => u.byDay.get(d) ?? 0).join(','),
    sparkDays: r.days.join(','),
    byType: byTypeOf(u),
    href: tasksHref(r, `&f.executedBy=eq:${enc(u.user)}`),
  }));
  return {
    kpis: [
      {
        label: 'Associates',
        value: String(users.length),
        hint: 'Completed at least one task',
        href: tasksHref(r, ''),
      },
      {
        label: 'Units handled',
        value: fmtInt(users.reduce((a, u) => a + u.units, 0)),
        hint: 'Units on completed tasks in the period',
        href: tasksHref(r, ''),
      },
      {
        label: 'Team speed',
        value: `${speedOf(
          measuredOf(facts).length,
          facts.reduce((a, f) => a + f.mins, 0),
        )} tasks/h`,
        hint: 'Timed tasks per measured hour',
        href: tasksHref(r, ''),
      },
      bestSpeedKpi(rows),
    ],
    charts: [
      {
        id: 'scorecards',
        title: 'Associate scorecards',
        description:
          'Ranked by tasks completed. Pick an associate for their daily trend and task mix; click a card to open their tasks.',
        kind: 'scorecards',
        xKey: 'user',
        wide: true,
        series: [{ key: 'tasks', label: 'Tasks', color: PALETTE[0] }],
        rows,
        hrefKey: 'href',
        columns: [
          { key: 'rank', label: 'Rank', kind: 'number' },
          { key: 'user', label: 'Associate' },
          { key: 'tasks', label: 'Tasks', kind: 'number' },
          { key: 'units', label: 'Units', kind: 'number' },
          { key: 'speed', label: 'Tasks per hour', kind: 'decimal' },
          { key: 'avgMinutes', label: 'Avg task (min)', kind: 'minutes' },
          { key: 'hours', label: 'Hours', kind: 'hours' },
          { key: 'activeDays', label: 'Active days', kind: 'number' },
        ],
      },
    ],
  };
}

async function receivingPerformance(
  db: AppDb,
  r: Range,
  wh: readonly string[],
  self: SelfScope | null,
): Promise<{ kpis: AnalyticsKpi[]; charts: AnalyticsChart[] }> {
  const rows = await dbAll<{
    user: string;
    d: string;
    units: number;
    lines: number;
    first: string;
    last: string;
  }>(
    db,
    sql`
    SELECT COALESCE(u.name, r.received_by) AS user, ${daySql('r.received_at', r)} AS d, SUM(r.uom_quantity) AS units, COUNT(*) AS lines,
           MIN(r.received_at) AS first, MAX(r.received_at) AS last
    FROM receipts r LEFT JOIN users u ON u.email = r.received_by OR u.id = r.received_by
    WHERE r.cancelled_at IS NULL AND r.type IN ('Purchase Order', 'Return', 'Product Receive') AND r.received_at >= ${r.fromIso} AND r.received_at < ${r.toIso} AND ${whIn('r.warehouse_id', wh)} AND ${clIn('r.client_id', r)}
      AND ${self ? sql`(u.id = ${self.id} OR r.received_by IN (${self.id}, ${self.email}))` : sql`1 = 1`}
    GROUP BY 1, 2`,
  );
  // Dock hours per user-day: first → last receipt, at least 15 minutes.
  const per = new Map<string, { units: number; lines: number; hours: number; days: number }>();
  for (const x of rows) {
    const h = Math.max((Date.parse(x.last) - Date.parse(x.first)) / 3_600_000, 0.25);
    const a = per.get(x.user) ?? { units: 0, lines: 0, hours: 0, days: 0 };
    per.set(x.user, {
      units: a.units + Number(x.units),
      lines: a.lines + Number(x.lines),
      hours: a.hours + h,
      days: a.days + 1,
    });
  }
  const href = `${RECEIVING_GRID}?${rangeFilter('receivedAt', r)}${clientQs(r)}${warehouseQs(wh)}`;
  const out: AnalyticsRow[] = [...per.entries()]
    .sort((a, b) => b[1].units - a[1].units)
    .map(([user, a]) => ({
      user,
      units: a.units,
      lines: a.lines,
      hours: round(a.hours, 1),
      unitsPerHour: round(a.units / a.hours, 1),
      linesPerHour: round(a.lines / a.hours, 1),
      days: a.days,
      href: receiverHref(r, wh, user),
    }));
  const units = out.reduce((s, x) => s + Number(x.units), 0);
  const hours = out.reduce((s, x) => s + Number(x.hours), 0);
  const daily: AnalyticsRow[] = r.days.map((day) => ({
    day,
    units: rows.filter((x) => x.d === day).reduce((s, x) => s + Number(x.units), 0),
    lines: rows.filter((x) => x.d === day).reduce((s, x) => s + Number(x.lines), 0),
    href: `${RECEIVING_GRID}?${dayFilter('receivedAt', day, r)}${clientQs(r)}${warehouseQs(wh)}`,
  }));
  return {
    kpis: [
      { label: 'Units received', value: fmtInt(units), hint: 'Received in the period', href },
      {
        label: 'Receipt lines',
        value: fmtInt(out.reduce((s, x) => s + Number(x.lines), 0)),
        hint: 'One per SKU per receipt',
        href,
      },
      {
        label: 'Units per dock hour',
        value: hours ? fmtInt(units / hours) : 'None',
        hint: `${round(hours, 1)} dock hours`,
        href,
      },
      { label: 'Receivers', value: String(out.length), hint: 'Associates who received in the period', href },
    ],
    charts: [
      {
        id: 'per-user',
        title: 'Units and lines per hour by associate',
        description:
          "Dock hours run from each associate's first to last receipt of the day. Click an associate to open their receiving.",
        kind: 'bar',
        xKey: 'user',
        series: [
          { key: 'unitsPerHour', label: 'Units / hour', color: PALETTE[0] },
          { key: 'linesPerHour', label: 'Lines / hour', color: PALETTE[1] },
        ],
        rows: out,
        hrefKey: 'href',
        columns: [
          { key: 'user', label: 'Associate' },
          { key: 'units', label: 'Units', kind: 'number' },
          { key: 'lines', label: 'Lines', kind: 'number' },
          { key: 'hours', label: 'Dock hours', kind: 'hours' },
          { key: 'unitsPerHour', label: 'Units / hour', kind: 'decimal' },
          { key: 'linesPerHour', label: 'Lines / hour', kind: 'decimal' },
        ],
        gridHref: href,
        gridLabel: 'Open receiving history',
      },
      {
        id: 'daily',
        title: 'Units received per day',
        description: 'All receivers combined. Click a day to open its receipts.',
        kind: 'area',
        xKey: 'day',
        series: [{ key: 'units', label: 'Units', color: PALETTE[0] }],
        rows: daily,
        hrefKey: 'href',
        columns: [
          { key: 'day', label: 'Day' },
          { key: 'units', label: 'Units', kind: 'number' },
          { key: 'lines', label: 'Lines', kind: 'number' },
        ],
        gridHref: href,
        gridLabel: 'Open receiving history',
      },
    ],
  };
}

/** The signed-in associate, for self-only labor analytics (no team permission). */
export interface SelfScope {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

/**
 * Builds a labor dashboard. With `self` set (a viewer without the team permission) every page
 * is narrowed to the viewer's own work: own tasks only on Average Task / Associate Task, own dot
 * against the team medians on the Quadrant, own scorecard with the team rank on Associate, own
 * receipts on Receiving Performance. Coworkers' names and rates never leave the server.
 */
export async function buildLabor(
  db: AppDb,
  page: LaborPage,
  r0: Range,
  wh: readonly string[],
  self: SelfScope | null = null,
): Promise<{ kpis: AnalyticsKpi[]; charts: AnalyticsChart[]; timing?: TimingShare }> {
  const r: Range = self ? { ...r0, executedBy: self.name } : r0;
  if (page === 'receiving-performance') return await receivingPerformance(db, r, wh, self);
  const team = await loadTaskFacts(db, r, wh);
  const own = self ? team.filter((f) => f.userId === self.id) : team;
  // The share is over the tasks this viewer may see (own tasks in self-only mode).
  const timing = timingShare(own);
  if (page === 'average-task') return { ...averageTask(own, r), timing };
  if (page === 'associate-task') return { ...associateTask(own, r), timing };
  if (page === 'performance-quadrant') return { ...quadrant(team, r, self), timing };
  return { ...associates(team, r, self), timing };
}
