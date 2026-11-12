/**
 * Day bucketing for M12 monitoring charts and grouped grids. Timestamps are stored as UTC ISO
 * strings but every screen renders them in the viewer's local time, so per-day buckets must be
 * cut in that same time zone (an 11:46 PM CST event belongs to that evening, not to the next UTC
 * day). The client sends its IANA zone as `tz`; the server falls back to the warehouse zone.
 */

export const FALLBACK_TIME_ZONE = "America/Chicago";

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** A valid IANA zone name, or the fallback when the input is empty or unknown. */
export function safeTimeZone(tz: string | null | undefined, fallback: string = FALLBACK_TIME_ZONE): string {
  const candidate = (tz ?? "").trim();
  if (candidate) {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: candidate });
      return candidate;
    } catch {
      /* unknown zone → fallback */
    }
  }
  return fallback;
}

function dayFormatter(tz: string): Intl.DateTimeFormat {
  let f = dayFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormatters.set(tz, f);
  }
  return f;
}

/** `YYYY-MM-DD` of an instant in a time zone ("" for invalid input). */
export function dayKeyInZone(value: string | number | Date | null | undefined, tz: string): string {
  if (value === null || value === undefined || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const parts = dayFormatter(tz).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The last `n` calendar days (oldest first, today last) in a time zone. DST-safe. */
export function lastDaysInZone(now: Date, n: number, tz: string): string[] {
  const today = dayKeyInZone(now, tz);
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1, d - (n - 1 - i))).toISOString().slice(0, 10));
}

/** The viewer's IANA zone (client only; "" on the server). */
export function browserTimeZone(): string {
  try {
    return typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "" : "";
  } catch {
    return "";
  }
}

/** Evenly spaced "nice" axis ticks (1/2/2.5/5 × 10ⁿ) covering `peak`, e.g. 33 → 0,10,20,30,40. */
export function niceTicks(peak: number, target = 4): { readonly max: number; readonly ticks: readonly number[] } {
  const p = Math.max(0, Number.isFinite(peak) ? peak : 0);
  if (p <= 4) return { max: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = p / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag);
  const intStep = Math.max(1, Math.ceil(step));
  const max = Math.ceil(p / intStep) * intStep === p ? p + intStep : Math.ceil(p / intStep) * intStep;
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += intStep) ticks.push(t);
  return { max, ticks };
}
