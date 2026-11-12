/** IANA time-zone helpers for warehouse-local scheduling (no dependencies). */

export interface LocalParts {
  readonly date: string; // YYYY-MM-DD
  readonly hour: number;
  readonly minute: number;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function parts(date: Date, timeZone: string): Record<string, number> {
  return Object.fromEntries(formatter(timeZone).formatToParts(date)
    .filter((p) => p.type !== "literal")
    .map((p) => [p.type, Number(p.value)]));
}

/** True when `timeZone` is a valid IANA zone. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const p = parts(date, timeZone);
  const pad = (n: number | undefined): string => String(n ?? 0).padStart(2, "0");
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, hour: p.hour ?? 0, minute: p.minute ?? 0 };
}

/** Offset of `timeZone` from UTC at `date`, in ms (positive east of UTC). */
export function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(p.year ?? 1970, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** UTC instant of local midnight on `localDate` (YYYY-MM-DD) in `timeZone` (DST-safe). */
export function localMidnightUtc(localDate: string, timeZone: string): Date {
  const [y, m, d] = localDate.split("-").map(Number);
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - zoneOffsetMs(new Date(first), timeZone));
}
