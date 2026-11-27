/**
 * Notification emails for Projects and CRM: when a person's next email is due, and the one email
 * that lists their new notifications. Pure (no I/O). Each app reads its own notification rows and
 * prefs, then calls `emailDue` and `renderNotificationEmail`, and sends with `sendWithResend`.
 *
 * Frequencies:
 *   instant  every scheduler run (every 5 minutes), one email with everything new
 *   daily    once a day, at 8 AM or later in the person's time zone
 *   weekly   once a week, on Monday at 8 AM or later in the person's time zone
 *   off      never
 * Quiet hours (CRM) hold the email until they end. Nothing is lost: rows stay unsent until then.
 */
import { renderContent, type EmailBlock, type RenderedEmail } from './layout';

export type EmailFrequency = 'instant' | 'daily' | 'weekly' | 'off';

export interface QuietHours {
  readonly enabled: boolean;
  /** HH:MM, 24 hour. */
  readonly from: string;
  readonly to: string;
}

export interface EmailDueInput {
  readonly frequency: EmailFrequency;
  readonly now: Date;
  /** When this person's last notification email went out, if ever. */
  readonly lastSentAt: Date | null;
  /** IANA time zone. Unknown or empty falls back to America/Chicago. */
  readonly timeZone?: string | null;
  readonly quietHours?: QuietHours | null;
}

const FALLBACK_TZ = 'America/Chicago';
const DIGEST_HOUR = 8;
const HOUR_MS = 3_600_000;

function zoneOrFallback(timeZone: string | null | undefined): string {
  if (!timeZone) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_TZ;
  }
}

/** Local weekday (0 = Sunday) and minutes past midnight in `timeZone`. */
export function localClock(now: Date, timeZone?: string | null): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zoneOrFallback(timeZone),
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return { weekday: Math.max(0, weekday), minutes };
}

function toMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** True inside quiet hours. A window like 19:00 to 08:00 runs past midnight. */
export function inQuietHours(minutes: number, quiet: QuietHours | null | undefined): boolean {
  if (!quiet?.enabled) return false;
  const from = toMinutes(quiet.from);
  const to = toMinutes(quiet.to);
  if (from === null || to === null || from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/** Should this person get an email on this run? */
export function emailDue(input: EmailDueInput): boolean {
  if (input.frequency === 'off') return false;
  const clock = localClock(input.now, input.timeZone);
  if (inQuietHours(clock.minutes, input.quietHours)) return false;
  if (input.frequency === 'instant') return true;
  const since = input.lastSentAt ? input.now.getTime() - input.lastSentAt.getTime() : Number.POSITIVE_INFINITY;
  if (clock.minutes < DIGEST_HOUR * 60) return false;
  if (input.frequency === 'daily') return since >= 20 * HOUR_MS;
  return clock.weekday === 1 && since >= 6 * 24 * HOUR_MS;
}

export interface NotificationLine {
  /** One plain sentence: "Lauren assigned you to Pack Frida trays". */
  readonly title: string;
  /** Optional second line, for example a comment preview. */
  readonly detail?: string | null;
  /** Absolute link to open it. */
  readonly url?: string | null;
}

export interface NotificationEmailInput {
  /** Which app: "Projects" or "CRM". */
  readonly app: string;
  readonly recipientName: string | null;
  readonly orgName: string;
  readonly lines: readonly NotificationLine[];
  /** Absolute link to the app's inbox. */
  readonly inboxUrl: string;
  /** Absolute link to the page where the person changes email settings. */
  readonly settingsUrl: string;
  readonly frequency: EmailFrequency;
}

/** At most this many lines are listed. The rest are counted. */
export const MAX_LINES = 15;

function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

export function renderNotificationEmail(input: NotificationEmailInput): RenderedEmail {
  const total = input.lines.length;
  const shown = input.lines.slice(0, MAX_LINES);
  const noun = total === 1 ? 'update' : 'updates';
  const subject =
    total === 1 && shown[0] ? `${input.app}: ${shown[0].title}` : `${input.app}: ${total} new ${noun} for you`;
  const greeting = firstName(input.recipientName);
  const blocks: EmailBlock[] = [
    {
      kind: 'text',
      text: `${greeting ? `Hi ${greeting}, here` : 'Here'} is what changed in ${input.orgName} ${input.app}.`,
    },
  ];
  for (const line of shown) {
    blocks.push({ kind: 'text', text: line.title });
    const extra = [line.detail ? `"${line.detail}"` : null, line.url ? `Open: ${line.url}` : null].filter(Boolean);
    if (extra.length > 0) blocks.push({ kind: 'note', text: extra.join('  ') });
  }
  if (total > shown.length) blocks.push({ kind: 'text', text: `And ${total - shown.length} more in your inbox.` });
  const single = total === 1 ? shown[0]?.url : null;
  const how =
    input.frequency === 'instant'
      ? 'as things happen'
      : input.frequency === 'daily'
        ? 'once a day'
        : 'once a week';
  return renderContent({
    subject,
    preheader: shown[0]?.title ?? `${total} new ${noun}`,
    heading: total === 1 ? 'You have a new update' : `You have ${total} new ${noun}`,
    blocks,
    button: { label: single ? 'Open it' : 'Open your inbox', url: single ?? input.inboxUrl },
    footer: `You get these emails ${how} because you are a member of ${input.orgName} in KitStak ${input.app}.\nChange or turn them off: ${input.settingsUrl}`,
    style: { tone: 'notice', eyebrow: 'Notifications', area: input.app.toUpperCase() },
  });
}
