/** Small, locale-aware date helpers for the automations center. */
const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const STEPS: readonly [limit: number, unit: Intl.RelativeTimeFormatUnit, seconds: number][] = [
  [60, 'second', 1],
  [3_600, 'minute', 60],
  [86_400, 'hour', 3_600],
  [604_800, 'day', 86_400],
  [2_629_800, 'week', 604_800],
  [31_557_600, 'month', 2_629_800],
  [Number.POSITIVE_INFINITY, 'year', 31_557_600],
];

export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  for (const [limit, unit, size] of STEPS) {
    if (abs < limit) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return DATE_TIME.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return 'None';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}
