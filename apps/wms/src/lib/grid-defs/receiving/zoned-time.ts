/**
 * One date-time rule for the receiving module (M05): instants render in the warehouse's time
 * zone, labelled, humanized — `Nov 10, 1:02 AM EST` (the year appears only when it differs
 * from the current one: `Nov 10, 2025, 1:02 AM EST`). The PO rail, the Receipts panel, the
 * receipt drawer, the PO / Receiving History grids and the change log all use it, so a time
 * reads the same everywhere regardless of the viewer's browser zone.
 */
export function formatZoned(
  value: string | null | undefined,
  timeZone: string | null | undefined = 'UTC',
  now: Date = new Date(),
): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    }).formatToParts(d);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fmt(timeZone || 'UTC');
  } catch {
    parts = fmt('UTC');
  }
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  const zone = get('timeZoneName');
  const year = get('year');
  const yearPart = year === String(now.getFullYear()) ? '' : `, ${year}`;
  const time = `${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
  return `${get('month')} ${get('day')}${yearPart}, ${time}${zone ? ` ${zone}` : ''}`;
}
