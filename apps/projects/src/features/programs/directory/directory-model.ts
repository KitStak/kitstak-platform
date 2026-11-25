/**
 * Pure model for the Programs directory (docs/programs/SPEC.md 5.3): filters, sorting, the subtitle
 * counts, table totals by unit label and the CSV export. Money stays whole cents in bigint; the
 * text comes from the engine format helpers so the directory prints the same numbers as Overview,
 * Pulse and CRM. Unit tested in `directory-model.test.ts`.
 */
import { formatCents, formatPercentBp, fromScaled, quantityToScaled, unitLabel } from '@kitstak/programs-engine';
import type { Health, ProgramListItemDTO } from '@/lib/program-types';
import type { ProjectStatus } from '@/lib/constants';

export type DirectoryLayout = 'cards' | 'table' | 'trends';
export type DirectorySort = 'name' | 'revenue' | 'target' | 'today' | 'updated';
export type SortDir = 'asc' | 'desc';
export type TableColumn =
  | 'customer'
  | 'status'
  | 'health'
  | 'today'
  | 'units'
  | 'revenue'
  | 'linked'
  | 'forecast'
  | 'target'
  | 'targetBp'
  | 'minimum'
  | 'pulse'
  | 'owner'
  | 'updated';

export const TABLE_COLUMNS: readonly { readonly id: TableColumn; readonly label: string; readonly money?: boolean }[] = [
  { id: 'customer', label: 'Customer' },
  { id: 'status', label: 'Status' },
  { id: 'health', label: 'Health' },
  { id: 'today', label: 'Today' },
  { id: 'units', label: 'Units' },
  { id: 'revenue', label: 'Revenue', money: true },
  { id: 'linked', label: 'With linked jobs', money: true },
  { id: 'forecast', label: 'Forecast', money: true },
  { id: 'target', label: 'Target', money: true },
  { id: 'targetBp', label: '% of target', money: true },
  { id: 'minimum', label: 'Below minimum', money: true },
  { id: 'pulse', label: 'Pulse job' },
  { id: 'owner', label: 'Owner' },
  { id: 'updated', label: 'Updated' },
];

/**
 * Hidden until turned on in Columns, so the default set fits a laptop screen: "With linked jobs"
 * (5.3), "Below minimum so far", "Pulse job" and "Updated".
 */
export const DEFAULT_HIDDEN_COLUMNS: readonly TableColumn[] = ['linked', 'minimum', 'pulse', 'updated'];

export const SORT_OPTIONS: readonly { readonly value: DirectorySort; readonly label: string; readonly money?: boolean }[] = [
  { value: 'name', label: 'Name' },
  { value: 'revenue', label: 'Revenue this month', money: true },
  { value: 'target', label: '% of target', money: true },
  { value: 'today', label: "Today's builds" },
  { value: 'updated', label: 'Updated' },
];

/** Status choices in the Filter menu (5.3), in this order. */
export const STATUS_FILTERS: readonly { readonly value: ProjectStatus; readonly label: string }[] = [
  { value: 'active', label: 'Running' },
  { value: 'on_hold', label: 'Paused' },
  { value: 'planning', label: 'Setting up' },
  { value: 'completed', label: 'Ended' },
  { value: 'archived', label: 'Archived' },
];

export const DEFAULT_STATUSES: readonly ProjectStatus[] = ['active', 'on_hold', 'planning'];

export const HEALTH_FILTERS: readonly { readonly value: Health; readonly label: string }[] = [
  { value: 'on_track', label: 'On track' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'off_track', label: 'Off track' },
];

export interface DirectoryFilters {
  readonly q: string;
  readonly statuses: readonly ProjectStatus[];
  readonly health: readonly Health[];
  /** Customer ids (core customer or CRM account). */
  readonly customers: readonly string[];
  readonly owners: readonly string[];
  readonly starred: boolean;
}

export const DEFAULT_FILTERS: DirectoryFilters = { q: '', statuses: DEFAULT_STATUSES, health: [], customers: [], owners: [], starred: false };

export interface DirectoryPrefs {
  readonly layout: DirectoryLayout;
  readonly sort: DirectorySort;
  readonly dir: SortDir;
  readonly hidden: readonly TableColumn[];
  readonly trendsMetric: TrendsMetric;
}

export type TrendsMetric = 'units' | 'revenue' | 'both';

export const DEFAULT_PREFS: DirectoryPrefs = { layout: 'cards', sort: 'name', dir: 'asc', hidden: DEFAULT_HIDDEN_COLUMNS, trendsMetric: 'both' };

/** Reads saved prefs, keeping only known values (old or hand edited storage never breaks the page). */
export function readPrefs(raw: unknown): DirectoryPrefs {
  if (!raw || typeof raw !== 'object') return DEFAULT_PREFS;
  const value = raw as Record<string, unknown>;
  const layout = (['cards', 'table', 'trends'] as const).find((entry) => entry === value.layout) ?? DEFAULT_PREFS.layout;
  const sort = SORT_OPTIONS.find((entry) => entry.value === value.sort)?.value ?? DEFAULT_PREFS.sort;
  const dir = value.dir === 'desc' ? 'desc' : 'asc';
  const hidden = Array.isArray(value.hidden) ? (value.hidden.filter((entry) => TABLE_COLUMNS.some((column) => column.id === entry)) as TableColumn[]) : DEFAULT_PREFS.hidden;
  const trendsMetric = (['units', 'revenue', 'both'] as const).find((entry) => entry === value.trendsMetric) ?? DEFAULT_PREFS.trendsMetric;
  return { layout, sort, dir, hidden, trendsMetric };
}

/** Reads a saved view's filters, keeping only known values. */
export function readFilters(raw: unknown): DirectoryFilters {
  if (!raw || typeof raw !== 'object') return DEFAULT_FILTERS;
  const value = raw as Record<string, unknown>;
  const strings = (input: unknown): string[] => (Array.isArray(input) ? input.filter((entry): entry is string => typeof entry === 'string') : []);
  return {
    q: typeof value.q === 'string' ? value.q : '',
    statuses: Array.isArray(value.statuses) ? (strings(value.statuses).filter((s) => STATUS_FILTERS.some((f) => f.value === s)) as ProjectStatus[]) : DEFAULT_STATUSES,
    health: strings(value.health).filter((h) => HEALTH_FILTERS.some((f) => f.value === h)) as Health[],
    customers: strings(value.customers),
    owners: strings(value.owners),
    starred: value.starred === true,
  };
}

export function sameFilters(a: DirectoryFilters, b: DirectoryFilters): boolean {
  const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && [...x].sort().join('|') === [...y].sort().join('|');
  return a.q.trim() === b.q.trim() && a.starred === b.starred && same(a.statuses, b.statuses) && same(a.health, b.health) && same(a.customers, b.customers) && same(a.owners, b.owners);
}

/** How many filters differ from "everything that is not ended or archived". */
export function activeFilterCount(filters: DirectoryFilters): number {
  let count = 0;
  if (!sameStatuses(filters.statuses, DEFAULT_STATUSES)) count += 1;
  if (filters.health.length) count += 1;
  if (filters.customers.length) count += 1;
  if (filters.owners.length) count += 1;
  if (filters.starred) count += 1;
  return count;
}

function sameStatuses(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry) => b.includes(entry));
}

/** The status a program shows under: archived programs count as Archived whatever their status. */
export function effectiveStatus(program: Pick<ProgramListItemDTO, 'status' | 'archivedAt'>): ProjectStatus {
  return program.archivedAt ? 'archived' : program.status;
}

/** Matches the search box: name, key, customer and (when known) variant SKUs. */
export function matchesSearch(program: ProgramListItemDTO, q: string, skus: readonly string[] = []): boolean {
  const term = q.trim().toLowerCase();
  if (!term) return true;
  return [program.name, program.key, program.customer?.name ?? '', ...skus].some((text) => text.toLowerCase().includes(term));
}

export function filterPrograms(list: readonly ProgramListItemDTO[], filters: DirectoryFilters, skusByProgram: ReadonlyMap<string, readonly string[]> = new Map()): ProgramListItemDTO[] {
  return list.filter((program) => {
    if (filters.statuses.length && !filters.statuses.includes(effectiveStatus(program))) return false;
    if (filters.health.length && (!program.health || !filters.health.includes(program.health))) return false;
    if (filters.customers.length && (!program.customer || !filters.customers.includes(program.customer.id))) return false;
    if (filters.owners.length && (!program.owner || !filters.owners.includes(program.owner.id))) return false;
    if (filters.starred && !program.starred) return false;
    return matchesSearch(program, filters.q, skusByProgram.get(program.id));
  });
}

const big = (value: string | null | undefined): bigint => {
  if (!value) return BigInt(0);
  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
};

const qtyBig = (value: string | null | undefined): bigint => {
  if (!value) return BigInt(0);
  try {
    return quantityToScaled(value);
  } catch {
    return BigInt(0);
  }
};

function cmpBig(a: bigint, b: bigint): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/** Sorted copy. Programs with no number for the sort key sit last in either direction. */
export function sortPrograms(list: readonly ProgramListItemDTO[], sort: DirectorySort, dir: SortDir): ProgramListItemDTO[] {
  const sign = dir === 'asc' ? 1 : -1;
  const missing = (program: ProgramListItemDTO): boolean => {
    if (sort === 'revenue') return program.month.revenueCents === null;
    if (sort === 'target') return program.month.targetBp === null;
    return false;
  };
  const compare = (a: ProgramListItemDTO, b: ProgramListItemDTO): number => {
    switch (sort) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'revenue':
        return cmpBig(big(a.month.revenueCents), big(b.month.revenueCents));
      case 'target':
        return (a.month.targetBp ?? 0) - (b.month.targetBp ?? 0);
      case 'today':
        return a.today.builds - b.today.builds || a.today.done - b.today.done;
      case 'updated':
        return a.updatedAt.localeCompare(b.updatedAt);
    }
  };
  return [...list].sort((a, b) => {
    const ma = missing(a);
    const mb = missing(b);
    if (ma !== mb) return ma ? 1 : -1;
    return sign * compare(a, b) || a.name.localeCompare(b.name);
  });
}

/** Units grouped by unit label, never added across labels: [{ unit: kits, units: '14172.000' }]. */
export function unitsByLabel<T>(list: readonly T[], read: (item: T) => { readonly unit: { readonly singular: string; readonly plural: string }; readonly units: string }): { readonly unit: { readonly singular: string; readonly plural: string }; readonly units: string }[] {
  const groups = new Map<string, { unit: { singular: string; plural: string }; total: bigint }>();
  for (const item of list) {
    const { unit, units } = read(item);
    const key = unit.plural.toLowerCase();
    const group = groups.get(key) ?? { unit: { singular: unit.singular, plural: unit.plural }, total: BigInt(0) };
    group.total += qtyBig(units);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({ unit: group.unit, units: fromScaled(group.total, 3) }));
}

/** "14,172 kits · 3,120 orders". */
export function unitsByLabelText(groups: readonly { readonly unit: { readonly singular: string; readonly plural: string }; readonly units: string }[]): string {
  if (groups.length === 0) return 'No units yet';
  return groups.map((group) => unitLabel(group.units, group.unit)).join(' · ');
}

export interface DirectoryTotals {
  readonly programs: number;
  readonly todayBuilds: number;
  readonly todayDone: number;
  readonly units: ReturnType<typeof unitsByLabel>;
  /** Null when any program in the list hides money. */
  readonly revenueCents: string | null;
  readonly forecastCents: string | null;
  readonly targetCents: string | null;
  readonly linkedCents: string | null;
  readonly minimumGapCents: string | null;
}

/** The table totals row (5.3): money summed in cents, units summed per unit label. */
export function directoryTotals(list: readonly ProgramListItemDTO[]): DirectoryTotals {
  const hidden = list.some((program) => program.moneyHidden);
  const sum = (read: (program: ProgramListItemDTO) => string | null) => (hidden ? null : list.reduce((total, program) => total + big(read(program)), BigInt(0)).toString());
  return {
    programs: list.length,
    todayBuilds: list.reduce((total, program) => total + program.today.builds, 0),
    todayDone: list.reduce((total, program) => total + program.today.done, 0),
    units: unitsByLabel(list, (program) => ({ unit: program.unit, units: program.month.units })),
    revenueCents: sum((program) => program.month.revenueCents),
    forecastCents: sum((program) => program.month.forecastCents),
    targetCents: sum((program) => program.month.targetCents),
    linkedCents: sum((program) => program.month.linkedJobsCents ?? program.month.revenueCents),
    minimumGapCents: sum((program) => program.month.minimumGapSoFarCents),
  };
}

/**
 * The directory subtitle: "4 running · 1 paused · $96,950 this month · 1 below target". Money
 * parts drop out when any program hides money (the numbers come from `listPrograms`).
 */
export function directorySubtitle(list: readonly ProgramListItemDTO[]): string {
  const live = list.filter((program) => !program.archivedAt);
  if (live.length === 0) return 'No programs yet';
  const running = live.filter((program) => program.status === 'active').length;
  const paused = live.filter((program) => program.status === 'on_hold').length;
  const setup = live.filter((program) => program.status === 'planning').length;
  const parts: string[] = [`${running} running`];
  if (paused) parts.push(`${paused} paused`);
  if (setup) parts.push(`${setup} setting up`);
  const hidden = live.some((program) => program.moneyHidden);
  if (!hidden) {
    const total = live.reduce((sum, program) => sum + big(program.month.revenueCents), BigInt(0));
    parts.push(`${formatCents(total)} this month`);
    const below = live.filter((program) => program.month.targetBp !== null && program.month.targetBp < 10000).length;
    if (below) parts.push(`${below} below target`);
  }
  return parts.join(' · ');
}

/** "105% of target" for a card, or null when the program has no target or hides money. */
export function targetLine(program: ProgramListItemDTO): string | null {
  if (program.moneyHidden || program.month.targetBp === null) return null;
  return `${formatPercentBp(program.month.targetBp)} of target`;
}

/** "May miss minimum by $1,240" when the projected gap is above 0, else null. */
export function minimumRiskText(program: ProgramListItemDTO): string | null {
  if (program.moneyHidden) return null;
  const gap = big(program.month.projectedGapCents);
  if (gap <= BigInt(0)) return null;
  return `May miss minimum by ${formatCents(gap)}`;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The selected rows as CSV (Export CSV in the bulk bar). Money columns only with money access. */
export function programsCsv(list: readonly ProgramListItemDTO[]): string {
  const money = !list.some((program) => program.moneyHidden);
  const header = ['Key', 'Name', 'Customer', 'Status', 'Health', 'Builds today', 'Done today', 'Units this month', 'Unit', ...(money ? ['Revenue this month', 'Forecast', 'Target', '% of target', 'Below minimum so far'] : []), 'Pulse job', 'Owner'];
  const status: Readonly<Record<ProjectStatus, string>> = { planning: 'Setting up', active: 'Running', on_hold: 'Paused', completed: 'Ended', archived: 'Archived' };
  const health: Readonly<Record<Health, string>> = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };
  const dollars = (cents: string | null) => (cents === null ? '' : fromScaled(big(cents), 2));
  const rows = list.map((program) => [
    program.key,
    program.name,
    program.customer?.name ?? '',
    status[effectiveStatus(program)],
    program.health ? health[program.health] : '',
    String(program.today.builds),
    String(program.today.done),
    fromScaled(qtyBig(program.month.units), 3),
    program.unit.plural,
    ...(money ? [dollars(program.month.revenueCents), dollars(program.month.forecastCents), dollars(program.month.targetCents), program.month.targetBp === null ? '' : formatPercentBp(program.month.targetBp), dollars(program.month.minimumGapSoFarCents)] : []),
    program.pulseJob?.number ?? '',
    program.owner?.name ?? '',
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

/** Distinct customers of the list, for the Customer filter. */
export function customerOptions(list: readonly ProgramListItemDTO[]): { readonly id: string; readonly name: string; readonly kind: 'core' | 'crm_account' }[] {
  const seen = new Map<string, { id: string; name: string; kind: 'core' | 'crm_account' }>();
  for (const program of list) if (program.customer && !seen.has(program.customer.id)) seen.set(program.customer.id, { ...program.customer });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Distinct owners of the list, for the Owner filter. */
export function ownerOptions(list: readonly ProgramListItemDTO[]): { readonly id: string; readonly name: string }[] {
  const seen = new Map<string, { id: string; name: string }>();
  for (const program of list) if (program.owner && !seen.has(program.owner.id)) seen.set(program.owner.id, { ...program.owner });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
