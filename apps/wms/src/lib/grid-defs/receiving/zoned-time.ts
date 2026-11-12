/**
 * One date-time rule for the receiving module (M05): instants render in the warehouse's time
 * zone, labelled, as `2026/11/10 1:02 AM EST`. The PO rail, the Receipts panel, the receipt
 * drawer, the PO / Receiving History grids and the change log all use it, so a time reads the
 * same everywhere regardless of the viewer's browser zone.
 */
export function formatZoned(
  value: string | null | undefined,
  timeZone: string | null | undefined = 'UTC',
): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
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
  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}${zone ? ` ${zone}` : ''}`;
}
