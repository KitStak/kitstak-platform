/**
 * Pure, server-safe date helpers for audit text (no React): render a timestamp in a given
 * IANA zone with a zone suffix ("11/10/2026 12:44 AM EST"), and localise ISO date-times
 * embedded in stored change-log messages ("… --> 2026-11-10T03:09:52.527Z").
 */

/** ISO date-time (date + time, optional seconds/fraction and Z / offset). */
export const ISO_DATETIME_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;

/** True when the whole value is an ISO date-time. */
export function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** Replaces each ISO date-time inside `text` with `format(iso)`. */
export function localizeIsoInText(text: string, format: (iso: string) => string): string {
  return text.replace(ISO_DATETIME_RE, (iso) => (Number.isNaN(Date.parse(iso)) ? iso : format(iso)));
}

/**
 * Change-log style "M/D/YYYY h:mm:ss AM TZ" in `timeZone` (Logiwa format plus the zone
 * abbreviation). Non-ISO input is returned unchanged.
 */
export function formatLogDateTime(value: string, timeZone = "UTC"): string {
  if (!isIsoDateTime(value)) return value;
  const date = new Date(value);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true, timeZoneName: "short" }).formatToParts(date);
  } catch {
    return timeZone === "UTC" ? value : formatLogDateTime(value, "UTC");
  }
  const p = (t: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("month")}/${p("day")}/${p("year")} ${p("hour")}:${p("minute")}:${p("second")} ${p("dayPeriod").toUpperCase()} ${p("timeZoneName")}`.trimEnd();
}

/** "MM/DD/YYYY hh:mm AM TZ" in `timeZone` (the viewer's zone when omitted). */
export function formatInZone(value: string | Date | null | undefined, timeZone?: string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  try {
    return new Intl.DateTimeFormat("en-US", {
      ...(timeZone ? { timeZone } : {}),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    })
      .format(d)
      .replace(",", "");
  } catch {
    return d.toISOString();
  }
}
