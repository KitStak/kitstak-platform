/**
 * Activity filters for the program Activity tab (docs/programs/SPEC.md 5.15). The server groups
 * verbs into money, output, plan and setup; each tab filter asks the server for the closest group
 * and keeps only its own verbs, so paging stays cheap.
 */
import type { ActivityDTO } from '@/lib/types';

export type ActivityFilter = 'all' | 'output' | 'prices' | 'variants' | 'builds' | 'runs' | 'schedules' | 'links' | 'close' | 'settings' | 'people';

interface FilterSpec {
  readonly label: string;
  /** The server group asked for (`/activity?filter=`). */
  readonly server: 'all' | 'money' | 'output' | 'plan' | 'setup';
  readonly match: (verb: string) => boolean;
}

const starts = (...prefixes: string[]) => (verb: string) => prefixes.some((prefix) => verb.startsWith(prefix));

/** Output verbs, so Everything can keep them without the whole server output group. */
const isOutputVerb = (verb: string) => verb.startsWith('build.output_') || verb === 'build.closed_short' || verb === 'build.split' || verb === 'time.logged';

/**
 * Everything is the union of the program filters below (plus output, comments, files and status
 * updates), so workspace rows such as automations, forms and fields never show here.
 */
const isProgramVerb = (verb: string): boolean =>
  isOutputVerb(verb) ||
  verb.startsWith('comment.') ||
  verb.startsWith('attachment.') ||
  verb === 'project.update_posted' ||
  (Object.keys(ACTIVITY_FILTERS) as ActivityFilter[]).some((filter) => filter !== 'all' && filter !== 'output' && ACTIVITY_FILTERS[filter].match(verb));

export const ACTIVITY_FILTERS: Readonly<Record<ActivityFilter, FilterSpec>> = {
  all: { label: 'Everything', server: 'all', match: (verb) => isProgramVerb(verb) },
  output: { label: 'Output', server: 'output', match: () => true },
  prices: { label: 'Prices', server: 'money', match: (verb) => verb.startsWith('price_card.') || verb.startsWith('one_time.') || verb === 'build.rate_override_set' || verb === 'build.repriced' },
  variants: { label: 'Variants', server: 'setup', match: starts('variant.', 'attributes.') },
  builds: { label: 'Builds', server: 'all', match: (verb) => verb.startsWith('build.') || verb.startsWith('task.') },
  runs: { label: 'Runs', server: 'plan', match: starts('run.') },
  schedules: { label: 'Schedules', server: 'plan', match: starts('schedule.') },
  links: { label: 'Links', server: 'setup', match: (verb) => verb.startsWith('link.') || verb.startsWith('program.pulse_job') },
  close: { label: 'Month close', server: 'money', match: (verb) => verb === 'program.month_closed' || verb === 'program.month_reopened' },
  settings: { label: 'Settings', server: 'setup', match: (verb) => verb === 'program.updated' || verb === 'program.settings_changed' || verb === 'program.status_changed' || verb === 'program.created' || verb === 'program.archived' || verb === 'program.restored' || verb === 'program.copied' || verb === 'calendar.updated' },
  people: { label: 'People', server: 'all', match: (verb) => verb.startsWith('project.member') || verb.startsWith('program.member') },
};

export function matchesFilter(row: Pick<ActivityDTO, 'verb'>, filter: ActivityFilter): boolean {
  return ACTIVITY_FILTERS[filter].match(row.verb);
}

/** "Today", "Yesterday", or "Monday, November 23" (with the year when it is not this year). */
export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

export function dayGroups<T extends Pick<ActivityDTO, 'createdAt'>>(rows: readonly T[], now = new Date()): { key: string; label: string; items: T[] }[] {
  const groups: { key: string; label: string; items: T[] }[] = [];
  for (const row of rows) {
    const key = new Date(row.createdAt).toDateString();
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(row);
    else groups.push({ key, label: dayLabel(row.createdAt, now), items: [row] });
  }
  return groups;
}

function cell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV of the loaded rows: When, Who, What, Kind. */
export function activityCsv<T extends Pick<ActivityDTO, 'createdAt' | 'verb'>>(rows: readonly T[], who: (row: T) => string, what: (row: T) => string): string {
  const lines = ['When,Who,What,Kind'];
  for (const row of rows) lines.push([row.createdAt, who(row), what(row), row.verb].map(cell).join(','));
  return `${lines.join('\n')}\n`;
}

/* ---------------------------------------------------------------------------------------------- */
/* Folding: one line for repeated work by the same person                                         */
/* ---------------------------------------------------------------------------------------------- */

type FoldRow = Pick<ActivityDTO, 'id' | 'verb' | 'actorId' | 'actorKind' | 'before' | 'after' | 'taskId' | 'createdAt'>;

export interface ActivityLine<T extends FoldRow> {
  readonly key: string;
  /** `cycle`: a draft started and then discarded; `repeat`: the same action again and again. */
  readonly kind: 'single' | 'cycle' | 'repeat';
  /** Newest first. For a cycle or a repeat of cycles, every row of every cycle. */
  readonly rows: readonly T[];
  /** How many actions the line stands for (cycles count once each). */
  readonly count: number;
  /** The start day of the drafts, for cycles. */
  readonly effectiveFrom: string | null;
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
const effectiveFromOf = (row: FoldRow): string | null => {
  const value = row.verb === 'price_card.variant_rate_changed' ? record(row.after).startsOn : record(row.verb === 'price_card.draft_created' ? row.after : row.before).effectiveFrom;
  return typeof value === 'string' ? value : null;
};
/** Rows that start a draft: a new draft, or a rate typed on the Variants tab (it lands in a draft). */
const startsDraft = (row: FoldRow) => row.verb === 'price_card.draft_created' || row.verb === 'price_card.variant_rate_changed';
/** A deleted price card version that was still a draft: the person discarded it. */
export const isDiscardedDraft = (row: Pick<FoldRow, 'verb' | 'before'>): boolean => row.verb === 'price_card.version_deleted' && record(row.before).status === 'draft';
const actorOf = (row: FoldRow) => `${row.actorKind}:${row.actorId ?? ''}`;

/**
 * Folds a day's rows (newest first): a draft that was started (or a rate typed into one) and then discarded by the same
 * person reads as one line, and the same action by the same person in a row folds into one line
 * with a count ("started and discarded 4 price card drafts for Nov 26"). Nothing is dropped:
 * a folded line keeps all its rows so the tab can show them.
 */
export function foldActivity<T extends FoldRow>(rows: readonly T[]): ActivityLine<T>[] {
  const units: { rows: T[]; kind: 'single' | 'cycle'; fold: string; effectiveFrom: string | null }[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const older = rows[index + 1];
    if (isDiscardedDraft(row) && older && startsDraft(older) && actorOf(older) === actorOf(row) && effectiveFromOf(older) === effectiveFromOf(row)) {
      units.push({ rows: [row, older], kind: 'cycle', fold: `cycle:${actorOf(row)}:${effectiveFromOf(row) ?? ''}`, effectiveFrom: effectiveFromOf(row) });
      index += 1;
      continue;
    }
    const target = row.verb.startsWith('price_card.') ? (effectiveFromOf(row) ?? '') : (row.taskId ?? '');
    const discarded = isDiscardedDraft(row) ? 'discarded' : '';
    units.push({ rows: [row], kind: 'single', fold: `${row.verb}:${discarded}:${actorOf(row)}:${row.verb.startsWith('price_card.') || row.verb.startsWith('build.output') ? '' : target}`, effectiveFrom: effectiveFromOf(row) });
  }
  const lines: ActivityLine<T>[] = [];
  let current: { units: typeof units } | null = null;
  const flush = () => {
    if (!current) return;
    const first = current.units[0]!;
    const all = current.units.flatMap((unit) => unit.rows);
    const kind = current.units.length > 1 ? 'repeat' : first.kind;
    lines.push({ key: all[0]!.id, kind: first.kind === 'cycle' ? 'cycle' : kind, rows: all, count: current.units.length, effectiveFrom: first.effectiveFrom });
    current = null;
  };
  for (const unit of units) {
    if (current && current.units[0]!.fold === unit.fold) current.units.push(unit);
    else {
      flush();
      current = { units: [unit] };
    }
  }
  flush();
  return lines;
}
