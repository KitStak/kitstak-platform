/**
 * Quiet hours for an alert rule: a daily window (and, if wanted, the weekend) in which the rule
 * raises nothing new. Whatever happens in the window shows up at the next check after it ends,
 * so nothing is lost. Stored in the rule's `scope.quiet`. Pure: used by the rule editor, the
 * rule evaluation and the tests.
 */
export interface QuietHours {
  /** "HH:MM", 24 hour clock, in the workspace time zone. */
  readonly from: string;
  readonly to: string;
  /** Also quiet all day on Saturday and Sunday. */
  readonly weekends?: boolean;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && TIME.test(value);
}

/** Reads quiet hours out of a rule's stored scope. `null` when the rule has none or they are not valid. */
export function quietOf(scope: unknown): QuietHours | null {
  const quiet = scope && typeof scope === 'object' ? (scope as { quiet?: unknown }).quiet : null;
  if (!quiet || typeof quiet !== 'object') return null;
  const { from, to, weekends } = quiet as { from?: unknown; to?: unknown; weekends?: unknown };
  if (!isClockTime(from) || !isClockTime(to) || from === to) return weekends === true ? { from: '00:00', to: '00:00', weekends: true } : null;
  return { from, to, weekends: weekends === true };
}

const minutes = (clock: string): number => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** Wall clock parts of `now` in a time zone. Falls back to UTC when the zone is not known. */
export function clockIn(timezone: string, now: Date = new Date()): { minutes: number; weekday: number } {
  const read = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(now);
    const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
    return { minutes: (Number(pick('hour')) % 24) * 60 + Number(pick('minute')), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(pick('weekday')) };
  };
  try {
    return read(timezone);
  } catch {
    return read('UTC');
  }
}

/** True when the rule should stay quiet right now. A window may cross midnight (18:00 to 06:00). */
export function isQuietNow(quiet: QuietHours | null, timezone: string, now: Date = new Date()): boolean {
  if (!quiet) return false;
  const clock = clockIn(timezone, now);
  if (quiet.weekends && (clock.weekday === 0 || clock.weekday === 6)) return true;
  if (quiet.from === quiet.to) return false;
  const from = minutes(quiet.from);
  const to = minutes(quiet.to);
  return from < to ? clock.minutes >= from && clock.minutes < to : clock.minutes >= from || clock.minutes < to;
}

/** "6:00 PM" from "18:00". */
export function clockLabel(clock: string): string {
  if (!isClockTime(clock)) return clock;
  const hour = Number(clock.slice(0, 2));
  const minute = clock.slice(3, 5);
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${minute} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** The quiet hours as a short sentence for the rule card. */
export function quietSentence(quiet: QuietHours | null): string {
  if (!quiet) return 'No quiet hours';
  const window = quiet.from === quiet.to ? '' : `Quiet from ${clockLabel(quiet.from)} to ${clockLabel(quiet.to)}`;
  if (quiet.weekends) return window ? `${window}, and on weekends` : 'Quiet on weekends';
  return window;
}
