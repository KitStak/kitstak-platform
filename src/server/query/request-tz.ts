/**
 * The viewer's UTC offset for the current API request (server only). `apiFetch` sends
 * `x-tz-offset` (minutes east of UTC, e.g. -300 for EST); `defineRoute` runs the handler
 * inside `runWithTzOffset`, so grid date chips ("Today", "Last 30 days", a picked day) cut at
 * the viewer's local midnight instead of UTC midnight. An explicit `tzOffsetMinutes` passed to
 * `compileFilters` (e.g. a warehouse zone) still wins.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const TZ_OFFSET_HEADER = "x-tz-offset";
const MAX_OFFSET_MINUTES = 14 * 60;

const store = new AsyncLocalStorage<{ readonly tzOffsetMinutes: number }>();

/** Parses the header value; null when absent or out of range. */
export function parseTzOffset(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && Math.abs(n) <= MAX_OFFSET_MINUTES ? n : null;
}

export function runWithTzOffset<T>(tzOffsetMinutes: number | null, fn: () => T): T {
  return tzOffsetMinutes === null ? fn() : store.run({ tzOffsetMinutes }, fn);
}

/** Offset of the request being handled, or undefined outside a request / without the header. */
export function currentTzOffset(): number | undefined {
  return store.getStore()?.tzOffsetMinutes;
}
