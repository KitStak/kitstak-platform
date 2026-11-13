/**
 * Shift window maths on the *warehouse* clock (BUILD_PLAN F2: warehouses.timezone,
 * day_shift_start / day_shift_end). Pure so dashboards can render it on the server or
 * tick it on the client.
 */

export interface ShiftWindowInput {
  readonly now: Date;
  readonly timeZone: string;
  /** "08:00" */
  readonly start: string;
  /** "17:00" */
  readonly end: string;
}

export type ShiftPhase = 'before' | 'during' | 'ended';

export interface ShiftWindow {
  readonly phase: ShiftPhase;
  /** 0..100 elapsed share of the shift. */
  readonly percent: number;
  /** Warehouse wall-clock time, "23:42". */
  readonly nowLabel: string;
  /** "Thu, Nov 5" in the warehouse zone. */
  readonly dateLabel: string;
  /** "12:45 – 17:00", "Shift ended 17:00" or "Starts 08:00". */
  readonly statusLabel: string;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseClock(value: string): number | null {
  const match = HHMM.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function wallClock(now: Date, timeZone: string): { readonly minutes: number; readonly label: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return {
    minutes: hour * 60 + minute,
    label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

/** Where the warehouse is within today's shift; after the end it reads "Shift ended 17:00". */
export function shiftWindow({ now, timeZone, start, end }: ShiftWindowInput): ShiftWindow {
  const zone = safeZone(timeZone);
  const startMin = parseClock(start) ?? 8 * 60;
  const endMin = parseClock(end) ?? 17 * 60;
  const clock = wallClock(now, zone);
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(now);
  const span = Math.max(1, endMin - startMin);
  if (clock.minutes < startMin)
    return { phase: 'before', percent: 0, nowLabel: clock.label, dateLabel, statusLabel: `Starts ${start}` };
  if (clock.minutes >= endMin)
    return {
      phase: 'ended',
      percent: 100,
      nowLabel: clock.label,
      dateLabel,
      statusLabel: `Shift ended ${end}`,
    };
  const percent = Math.round(((clock.minutes - startMin) / span) * 100);
  return {
    phase: 'during',
    percent,
    nowLabel: clock.label,
    dateLabel,
    statusLabel: `${clock.label} to ${end}`,
  };
}
