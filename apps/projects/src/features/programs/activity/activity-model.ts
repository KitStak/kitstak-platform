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

export const ACTIVITY_FILTERS: Readonly<Record<ActivityFilter, FilterSpec>> = {
  all: { label: 'Everything', server: 'all', match: () => true },
  output: { label: 'Output', server: 'output', match: () => true },
  prices: { label: 'Prices', server: 'money', match: (verb) => verb.startsWith('price_card.') || verb.startsWith('one_time.') || verb === 'build.rate_override_set' || verb === 'build.repriced' },
  variants: { label: 'Variants', server: 'setup', match: starts('variant.', 'attributes.') },
  builds: { label: 'Builds', server: 'all', match: (verb) => verb.startsWith('build.') || verb.startsWith('task.') },
  runs: { label: 'Runs', server: 'plan', match: starts('run.') },
  schedules: { label: 'Schedules', server: 'plan', match: starts('schedule.') },
  links: { label: 'Links', server: 'setup', match: (verb) => verb.startsWith('link.') || verb.startsWith('program.pulse_job') },
  close: { label: 'Month close', server: 'money', match: (verb) => verb === 'program.month_closed' || verb === 'program.month_reopened' },
  settings: { label: 'Settings', server: 'setup', match: (verb) => verb === 'program.updated' || verb === 'program.settings_changed' || verb === 'program.status_changed' || verb === 'program.created' },
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
