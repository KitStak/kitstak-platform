/**
 * Pure helpers for the Builds tab (docs/programs/SPEC.md 5.7): the builds filter chips that live
 * in the URL (`bf`), run grouping, the Done fold rule, totals and CSV. No React; unit tested in
 * `builds-model.test.ts`. Quantities are 3 decimal strings and are summed as scaled bigints.
 */
import { fromScaled, quantityToScaled } from '@kitstak/programs-engine';
import type { BuildBlockDTO, IsoDate } from '@/lib/program-types';
import type { TaskSummary } from '@/lib/types';
import type { WorkKind } from '@/features/views/task-source';

export const BUILD_FILTER_PARAM = 'bf';

export interface BuildFilters {
  /** Variant ids ("none" for builds with no variant). */
  readonly variants: readonly string[];
  readonly short: boolean;
  readonly unplanned: boolean;
  /** Builds, Tasks or Both (programs default Builds). */
  readonly workKind: WorkKind;
}

export const DEFAULT_BUILD_FILTERS: BuildFilters = { variants: [], short: false, unplanned: false, workKind: 'build' };

/** `v:id1,id2;short;unplanned;w:both` */
export function formatBuildFilters(filters: BuildFilters): string {
  const parts: string[] = [];
  if (filters.variants.length) parts.push(`v:${filters.variants.join(',')}`);
  if (filters.short) parts.push('short');
  if (filters.unplanned) parts.push('unplanned');
  if (filters.workKind !== 'build') parts.push(`w:${filters.workKind}`);
  return parts.join(';');
}

export function parseBuildFilters(value: string | null | undefined): BuildFilters {
  if (!value) return DEFAULT_BUILD_FILTERS;
  let variants: string[] = [];
  let short = false;
  let unplanned = false;
  let workKind: WorkKind = 'build';
  for (const part of value.split(';')) {
    if (part.startsWith('v:')) variants = part.slice(2).split(',').filter(Boolean);
    else if (part === 'short') short = true;
    else if (part === 'unplanned') unplanned = true;
    else if (part === 'w:task' || part === 'w:both') workKind = part.slice(2) as WorkKind;
  }
  return { variants, short, unplanned, workKind };
}

export function activeBuildFilterCount(filters: BuildFilters): number {
  return (filters.variants.length ? 1 : 0) + (filters.short ? 1 : 0) + (filters.unplanned ? 1 : 0) + (filters.workKind !== 'build' ? 1 : 0);
}

export function buildOf(task: TaskSummary): BuildBlockDTO | null {
  return task.kind === 'build' && task.build ? (task.build as unknown as BuildBlockDTO) : null;
}

/** Below plan on a closed build, or closed short. */
export function isShort(build: BuildBlockDTO, closed: boolean): boolean {
  if (build.closedShort) return true;
  return closed && quantityToScaled(build.builtQty) < quantityToScaled(build.plannedQty);
}

export function matchesBuildFilters(task: TaskSummary, filters: BuildFilters): boolean {
  const build = buildOf(task);
  if (filters.workKind === 'build' && !build) return false;
  if (filters.workKind === 'task' && build) return false;
  if (!build) return filters.variants.length === 0 && !filters.short && !filters.unplanned;
  if (filters.variants.length && !filters.variants.includes(build.variantId ?? 'none')) return false;
  if (filters.unplanned && !build.unplanned) return false;
  if (filters.short && !isShort(build, task.statusCategory === 'done' || task.statusCategory === 'cancelled')) return false;
  return true;
}

/** Done cards that fold on the board: dated before the range, or in long ranges older than today. */
export function foldsOnBoard(task: TaskSummary, range: { readonly from: IsoDate; readonly to: IsoDate }, today: IsoDate): boolean {
  if (task.statusCategory !== 'done') return false;
  const date = buildOf(task)?.buildDate ?? task.dueDate;
  if (!date) return false;
  if (date < range.from) return true;
  return range.from !== range.to && date < today;
}

/** The run key of a task ("run:manual:2026-11-25"); tasks group under "Other tasks". */
export const TASKS_GROUP = 'tasks';
export function runKeyOf(task: TaskSummary): string {
  return buildOf(task)?.runId ?? TASKS_GROUP;
}

/** Run keys newest day first; inside a day, scheduled runs before Unscheduled; tasks last. */
export function orderRunKeys(tasks: readonly TaskSummary[]): string[] {
  const keys = new Map<string, { date: string; manual: boolean }>();
  for (const task of tasks) {
    const build = buildOf(task);
    if (!build) continue;
    if (!keys.has(build.runId)) keys.set(build.runId, { date: build.buildDate, manual: build.scheduleId === null });
  }
  const ordered = [...keys.entries()].sort((a, b) => (a[1].date === b[1].date ? Number(a[1].manual) - Number(b[1].manual) || a[0].localeCompare(b[0]) : b[1].date.localeCompare(a[1].date))).map(([key]) => key);
  if (tasks.some((task) => !buildOf(task))) ordered.push(TASKS_GROUP);
  return ordered;
}

export function dayKeyOf(task: TaskSummary): string {
  return buildOf(task)?.buildDate ?? task.dueDate ?? 'none';
}

export function variantKeyOf(task: TaskSummary): string {
  const build = buildOf(task);
  if (!build) return TASKS_GROUP;
  return build.variantId ?? 'none';
}

export interface QtyTotals {
  readonly builds: number;
  readonly done: number;
  readonly planned: string;
  readonly built: string;
  readonly remaining: string;
  readonly scrap: string;
  /** Null when money is hidden on any row. */
  readonly revenueCents: string | null;
}

export function totalsOf(tasks: readonly TaskSummary[]): QtyTotals {
  let builds = 0;
  let done = 0;
  let planned = BigInt(0);
  let built = BigInt(0);
  let remaining = BigInt(0);
  let scrap = BigInt(0);
  let revenue: bigint | null = BigInt(0);
  for (const task of tasks) {
    const build = buildOf(task);
    if (!build) continue;
    builds += 1;
    if (task.statusCategory === 'done') done += 1;
    planned += quantityToScaled(build.plannedQty);
    built += quantityToScaled(build.builtQty);
    remaining += quantityToScaled(build.remainingQty);
    scrap += quantityToScaled(build.scrapQty);
    if (build.revenueCents === null) revenue = null;
    else if (revenue !== null) revenue += BigInt(build.revenueCents);
  }
  return { builds, done, planned: fromScaled(planned, 3), built: fromScaled(built, 3), remaining: fromScaled(remaining, 3), scrap: fromScaled(scrap, 3), revenueCents: revenue === null ? null : revenue.toString() };
}

/** RFC 4180 CSV text. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(',')).join('\n');
}

/* Display: what build cards and rows show, and the build orders (SPEC 5.7). */

export type BuildShowKey = 'qty' | 'revenue' | 'rate' | 'variant' | 'sku';
export const BUILD_SHOW_KEYS: readonly BuildShowKey[] = ['qty', 'revenue', 'rate', 'variant', 'sku'];
export const BUILD_SHOW_LABELS: Readonly<Record<BuildShowKey, string>> = { qty: 'Qty progress', revenue: 'Revenue', rate: 'Rate', variant: 'Variant chip', sku: 'SKU' };
/** On unless someone turns them off; Rate and SKU start off to keep cards short. */
export const BUILD_SHOW_DEFAULTS: Readonly<Record<BuildShowKey, boolean>> = { qty: true, revenue: true, rate: false, variant: true, sku: false };
export type BuildShow = Readonly<Record<BuildShowKey, boolean>>;

/** The stored set holds the keys flipped from their default. */
export function buildShowFrom(flipped: ReadonlySet<string>): BuildShow {
  const out = {} as Record<BuildShowKey, boolean>;
  for (const key of BUILD_SHOW_KEYS) out[key] = BUILD_SHOW_DEFAULTS[key] !== flipped.has(key);
  return out;
}

export type BuildOrderKey = 'day' | 'variant' | 'remaining';
export const BUILD_ORDER_LABELS: Readonly<Record<BuildOrderKey, string>> = { day: 'Day', variant: 'Variant order', remaining: 'Remaining qty' };

/** Compare two tasks for a build order. Ties fall back to the build key so the order is stable. */
export function compareBuilds(order: BuildOrderKey, variantRank: (id: string | null) => number): (a: TaskSummary, b: TaskSummary) => number {
  return (a, b) => {
    const ba = buildOf(a);
    const bb = buildOf(b);
    if (!ba || !bb) return Number(!ba) - Number(!bb) || a.key.localeCompare(b.key, undefined, { numeric: true });
    let diff = 0;
    if (order === 'day') diff = ba.buildDate.localeCompare(bb.buildDate) || variantRank(ba.variantId) - variantRank(bb.variantId);
    else if (order === 'variant') diff = variantRank(ba.variantId) - variantRank(bb.variantId) || ba.buildDate.localeCompare(bb.buildDate);
    else {
      const ra = quantityToScaled(ba.remainingQty);
      const rb = quantityToScaled(bb.remainingQty);
      diff = ra === rb ? 0 : ra > rb ? -1 : 1;
    }
    return diff || a.key.localeCompare(b.key, undefined, { numeric: true });
  };
}
