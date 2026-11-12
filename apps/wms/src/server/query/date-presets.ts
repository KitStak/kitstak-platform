/**
 * Date filter presets (Logiwa parity) → concrete [from, to] ISO ranges.
 *
 *   today | last3d | last7d | last30d | last90d | last12m
 *   ahead<N>d      "X Day(s) Ahead and More"   from start of (today+N), open end
 *   before<N>d     "X Day(s) Before and More"  open start, to end of (today-N)
 *   withinPast<N>d "Within X Day(s) Past"      start of (today-N) .. now
 *   withinNext<N>d "Within X Next Day(s)"      now .. end of (today+N)
 *   sun … sat      the most recent such day (today included), whole day
 *   custom:<from>..<to>  either side optional; date-only `to` means end of that day
 *
 * Day boundaries use `tzOffsetMinutes` (minutes EAST of UTC, e.g. CST = -360) so
 * "today" is the warehouse's local day. PURE: safe for client import.
 */

export const FIXED_DATE_PRESETS = ['today', 'last3d', 'last7d', 'last30d', 'last90d', 'last12m'] as const;
export const WEEKDAY_PRESETS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export const RELATIVE_DATE_PRESETS = ['ahead', 'before', 'withinPast', 'withinNext'] as const;

export type FixedDatePreset = (typeof FIXED_DATE_PRESETS)[number];
export type WeekdayPreset = (typeof WEEKDAY_PRESETS)[number];
export type RelativeDatePreset = (typeof RELATIVE_DATE_PRESETS)[number];

export type DateSpec =
  | { readonly kind: 'fixed'; readonly preset: FixedDatePreset }
  | { readonly kind: 'weekday'; readonly preset: WeekdayPreset }
  | { readonly kind: 'relative'; readonly preset: RelativeDatePreset; readonly days: number }
  | { readonly kind: 'custom'; readonly from?: string; readonly to?: string };

export interface DateRange {
  readonly from: string | null;
  readonly to: string | null;
}

export const MAX_RELATIVE_DAYS = 3650;
const DAY_MS = 86_400_000;
const RELATIVE_RE = /^(ahead|before|withinPast|withinNext)(\d{1,4})d$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}[-/]\d{2}[-/]\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
}

/** Parses a date filter value; returns null when it is not valid grammar. */
export function parseDateSpec(raw: string): DateSpec | null {
  const value = raw.trim();
  if (isOneOf(FIXED_DATE_PRESETS, value)) return { kind: 'fixed', preset: value };
  if (isOneOf(WEEKDAY_PRESETS, value)) return { kind: 'weekday', preset: value };
  const relative = RELATIVE_RE.exec(value);
  if (relative) {
    const days = Number(relative[2]);
    const preset = relative[1] as RelativeDatePreset;
    return days <= MAX_RELATIVE_DAYS ? { kind: 'relative', preset, days } : null;
  }
  if (value.startsWith('custom:')) {
    const body = value.slice('custom:'.length);
    const sep = body.indexOf('..');
    if (sep < 0) return null;
    const from = body.slice(0, sep).trim();
    const to = body.slice(sep + 2).trim();
    if ((from && !isValidDateText(from)) || (to && !isValidDateText(to)) || (!from && !to)) return null;
    return { kind: 'custom', ...(from ? { from } : {}), ...(to ? { to } : {}) };
  }
  return null;
}

export function serializeDateSpec(spec: DateSpec): string {
  switch (spec.kind) {
    case 'fixed':
    case 'weekday':
      return spec.preset;
    case 'relative':
      return `${spec.preset}${spec.days}d`;
    case 'custom':
      return `custom:${spec.from ?? ''}..${spec.to ?? ''}`;
  }
}

function isValidDateText(text: string): boolean {
  return DATE_TIME_RE.test(text) && !Number.isNaN(Date.parse(normalizeDateText(text)));
}

/** Accepts `YYYY/MM/DD HH:mm` (picker format) as well as ISO. */
function normalizeDateText(text: string): string {
  return text.replace(/\//g, '-').replace(' ', 'T');
}

/** Local-midnight (as a UTC instant) of the day containing `instant`, shifted by `dayDelta`. */
function startOfLocalDay(instant: number, tzOffsetMinutes: number, dayDelta = 0): number {
  const offsetMs = tzOffsetMinutes * 60_000;
  const localMidnight = Math.floor((instant + offsetMs) / DAY_MS) * DAY_MS;
  return localMidnight - offsetMs + dayDelta * DAY_MS;
}

const iso = (ms: number): string => new Date(ms).toISOString();

function customBoundary(text: string, end: boolean, tzOffsetMinutes: number): string {
  const normalized = normalizeDateText(text);
  if (DATE_ONLY_RE.test(normalized)) {
    const midnightUtc = Date.parse(`${normalized}T00:00:00Z`) - tzOffsetMinutes * 60_000;
    return iso(end ? midnightUtc + DAY_MS - 1 : midnightUtc);
  }
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(normalized);
  const ms = hasZone ? Date.parse(normalized) : Date.parse(`${normalized}Z`) - tzOffsetMinutes * 60_000;
  // A minute-precision `to` (picker "23:59") includes the whole minute.
  const minutePrecision = /T\d{2}:\d{2}$/.test(normalized);
  return iso(end && minutePrecision ? ms + 59_999 : ms);
}

/** Resolves a spec to an inclusive ISO range relative to `now`. */
export function resolveDateRange(spec: DateSpec, now: Date = new Date(), tzOffsetMinutes = 0): DateRange {
  const t = now.getTime();
  const dayStart = (delta: number): number => startOfLocalDay(t, tzOffsetMinutes, delta);
  const dayEnd = (delta: number): number => dayStart(delta + 1) - 1;

  switch (spec.kind) {
    case 'fixed': {
      if (spec.preset === 'today') return { from: iso(dayStart(0)), to: iso(dayEnd(0)) };
      if (spec.preset === 'last12m') {
        const local = new Date(dayStart(0) + tzOffsetMinutes * 60_000);
        local.setUTCFullYear(local.getUTCFullYear() - 1);
        return { from: iso(local.getTime() - tzOffsetMinutes * 60_000), to: iso(dayEnd(0)) };
      }
      const days = Number(spec.preset.slice(4, -1));
      return { from: iso(dayStart(-(days - 1))), to: iso(dayEnd(0)) };
    }
    case 'weekday': {
      const localDow = new Date(dayStart(0) + tzOffsetMinutes * 60_000).getUTCDay();
      const target = WEEKDAY_PRESETS.indexOf(spec.preset);
      const back = (localDow - target + 7) % 7;
      return { from: iso(dayStart(-back)), to: iso(dayEnd(-back)) };
    }
    case 'relative': {
      const n = spec.days;
      if (spec.preset === 'ahead') return { from: iso(dayStart(n)), to: null };
      if (spec.preset === 'before') return { from: null, to: iso(dayEnd(-n)) };
      if (spec.preset === 'withinPast') return { from: iso(dayStart(-n)), to: iso(t) };
      return { from: iso(t), to: iso(dayEnd(n)) };
    }
    case 'custom':
      return {
        from: spec.from ? customBoundary(spec.from, false, tzOffsetMinutes) : null,
        to: spec.to ? customBoundary(spec.to, true, tzOffsetMinutes) : null,
      };
  }
}
