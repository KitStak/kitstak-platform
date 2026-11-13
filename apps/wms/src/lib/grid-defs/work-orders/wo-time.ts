/**
 * Warehouse-time-zone timestamps for M08: the one time-zone policy for the Work Orders grid,
 * detail page, activity/change log, Create Kit summary, exports and print. Every value is shown
 * in the warehouse's zone with a zone suffix: "11/09/2026 11:44 PM CST". One formatter so the
 * same event never reads a different day or hour on two screens.
 */
export const DEFAULT_WAREHOUSE_ZONE = 'America/Chicago';

export function formatInZone(
  value: string | Date | null | undefined,
  timeZone: string | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return 'None';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || DEFAULT_WAREHOUSE_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    })
      .format(d)
      .replace(',', '');
  } catch {
    return d.toISOString();
  }
}

/** Short zone label for headers/tooltips, e.g. "CST". */
export function zoneLabel(timeZone: string | null | undefined, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || DEFAULT_WAREHOUSE_ZONE,
      timeZoneName: 'short',
    })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? (timeZone || DEFAULT_WAREHOUSE_ZONE);
  } catch {
    return timeZone || DEFAULT_WAREHOUSE_ZONE;
  }
}
