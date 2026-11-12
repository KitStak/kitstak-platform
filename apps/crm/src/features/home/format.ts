/** Pure formatting helpers for the home page (unit-tested). */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** "just now", "5m ago", "3h ago", "2d ago", then a short date. Invalid input → "". */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const diff = Math.max(0, now.getTime() - time);
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Due label for a YYYY-MM-DD date relative to `today` (also YYYY-MM-DD, local). */
export function formatDueLabel(due: string, today: string): { readonly text: string; readonly tone: 'overdue' | 'today' | 'soon' } {
  const parse = (value: string) => {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  const dueDate = parse(due);
  const days = Math.round((dueDate.getTime() - parse(today).getTime()) / DAY);
  const short = dueDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (days < 0) return { text: days === -1 ? 'Yesterday' : short, tone: 'overdue' };
  if (days === 0) return { text: 'Today', tone: 'today' };
  if (days === 1) return { text: 'Tomorrow', tone: 'soon' };
  return { text: dueDate.toLocaleDateString(undefined, { weekday: 'short' }), tone: 'soon' };
}

/** Group sizes → percentage widths that always sum to 100 (empty input → []). */
export function proportions(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total === 0) return counts.map(() => 0);
  const raw = counts.map((value) => (Math.max(0, value) / total) * 100);
  const rounded = raw.map((value) => Math.round(value * 10) / 10);
  const drift = Math.round((100 - rounded.reduce((sum, value) => sum + value, 0)) * 10) / 10;
  const largest = rounded.indexOf(Math.max(...rounded));
  return rounded.map((value, index) => (index === largest ? Math.round((value + drift) * 10) / 10 : value));
}

/** Simple English plural for item terminology ("Deal" → "Deals", "Activity" → "Activities"). */
export function pluralize(word: string, count: number): string {
  if (count === 1) return word;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

/** How many cards of at least `minWidth` fit side by side in `width` with `gap` between them. */
export function columnsThatFit(width: number, minWidth: number, gap: number): number {
  if (!Number.isFinite(width) || width <= 0 || minWidth <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (minWidth + gap)));
}
