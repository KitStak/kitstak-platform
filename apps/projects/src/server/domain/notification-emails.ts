/**
 * Notification emails. The scheduler (api/v1/integrations/events, every 5 minutes) calls
 * `deliverNotificationEmails` after the automation sweep, so new "due soon" and "overdue" rows go out
 * on the same run.
 *
 * For each person with unhandled notifications:
 *   1. Rows they already read or archived, and kinds that are not emailed, are marked handled.
 *   2. People who never signed in, left the org, or chose "Never email me" have every row marked
 *      handled, so a first sign in does not bring a pile of old mail.
 *   3. If their next email is due (Settings, Profile, Email), one email lists what is left.
 * Rows are locked with SKIP LOCKED, so two runs at once never send the same row twice, and each email
 * carries an idempotency key built from its row ids.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import {
  emailDue,
  renderNotificationEmail,
  resendReady,
  sendWithResend,
  type EmailFrequency,
  type SendResult,
} from '@kitstak/mail';
import { db, type Executor } from '@/server/db';
import { appUrl } from '@/server/env';

/** The kinds that are emailed. Everything else stays in the inbox only. */
export const EMAIL_KINDS = ['assigned', 'mention', 'comment', 'status_changed', 'due_soon', 'overdue'] as const;
const EMAIL_KIND_SET: ReadonlySet<string> = new Set(EMAIL_KINDS);

const RECIPIENTS_PER_RUN = 50;
const ROWS_PER_EMAIL = 100;
/** Resend allows a few sends a second. Billing mail uses the same gap. */
const SEND_GAP_MS = 550;

export interface EmailRunResult {
  readonly sent: number;
  readonly failed: number;
  readonly handled: number;
  /** Set when the run stopped early: mail is not set up, or Resend refused the key or sender. */
  readonly stopped?: string;
}

export interface DeliverOptions {
  readonly now?: Date;
  readonly send?: (message: Parameters<typeof sendWithResend>[0]) => Promise<SendResult>;
  /** For tests. Default: `resendReady()`. */
  readonly ready?: boolean;
  readonly sleep?: (ms: number) => Promise<void>;
}

type PendingRow = {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string | null;
  readonly url: string | null;
  readonly read_at: Date | null;
  readonly archived_at: Date | null;
};

type Person = {
  readonly email: string | null;
  readonly name: string | null;
  readonly timezone: string | null;
  readonly org_name: string;
  readonly member: boolean;
  readonly active: boolean;
  readonly digest: string | null;
  readonly last_sent: Date | null;
};

function frequencyOf(value: string | null): EmailFrequency {
  return value === 'daily' || value === 'weekly' || value === 'off' || value === 'instant' ? value : 'instant';
}

/** Path or absolute URL to an absolute URL on this app. */
function absolute(base: string, url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

async function markHandled(executor: Executor, ids: readonly string[], emailed: boolean): Promise<void> {
  if (ids.length === 0) return;
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  await executor.execute(sql`
    update pm.notifications
    set email_handled_at = now()${emailed ? sql`, emailed_at = now()` : sql``}
    where id in (${list})`);
}

/** Splits locked rows into the ones to email and the ones to set aside. Pure, for tests. */
export function sortRows(
  rows: readonly PendingRow[],
  person: Pick<Person, 'email' | 'member' | 'active' | 'digest'>,
): { send: PendingRow[]; settle: PendingRow[] } {
  const allowed = Boolean(person.email) && person.member && person.active && frequencyOf(person.digest) !== 'off';
  if (!allowed) return { send: [], settle: [...rows] };
  const send: PendingRow[] = [];
  const settle: PendingRow[] = [];
  for (const row of rows) {
    if (row.read_at || row.archived_at || !EMAIL_KIND_SET.has(row.kind)) settle.push(row);
    else send.push(row);
  }
  return { send, settle };
}

export async function deliverNotificationEmails(options: DeliverOptions = {}): Promise<EmailRunResult> {
  if (!(options.ready ?? resendReady())) return { sent: 0, failed: 0, handled: 0, stopped: 'Email is not set up (RESEND_API_KEY, EMAIL_FROM).' };
  const now = options.now ?? new Date();
  const send = options.send ?? ((message) => sendWithResend(message));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const base = appUrl();

  const recipients = await db.execute<{ org_id: string; user_id: string }>(sql`
    select distinct org_id::text as org_id, user_id::text as user_id
    from pm.notifications
    where email_handled_at is null
    limit ${RECIPIENTS_PER_RUN}`);

  let sent = 0;
  let failed = 0;
  let handled = 0;
  let stopped: string | undefined;
  for (const { org_id: orgId, user_id: userId } of recipients.rows) {
    if (stopped) break;
    const outcome = await db.transaction(async (tx) => {
      const locked = await tx.execute<PendingRow>(sql`
        select id::text as id, kind, title, body, url, read_at, archived_at
        from pm.notifications
        where org_id = ${orgId} and user_id = ${userId} and email_handled_at is null
        order by created_at
        limit ${ROWS_PER_EMAIL}
        for update skip locked`);
      if (locked.rows.length === 0) return null;
      const people = await tx.execute<Person>(sql`
        select u.email, u.name, u.timezone, o.name as org_name,
          exists (select 1 from core.member m where m.organization_id = o.id and m.user_id = u.id and m.role not like 'deactivated:%') as member,
          (exists (select 1 from core.session s where s.user_id = u.id)
            or exists (select 1 from pm.notifications r where r.user_id = u.id and (r.read_at is not null or r.emailed_at is not null))) as active,
          (select p.prefs ->> 'emailDigest' from pm.user_prefs p where p.org_id = o.id and p.user_id = u.id) as digest,
          (select max(x.emailed_at) from pm.notifications x where x.org_id = o.id and x.user_id = u.id) as last_sent
        from core."user" u, core.organization o
        where u.id = ${userId} and o.id = ${orgId}`);
      const person = people.rows[0];
      if (!person) {
        await markHandled(tx, locked.rows.map((row) => row.id), false);
        return { handled: locked.rows.length } as const;
      }
      const { send: toSend, settle } = sortRows(locked.rows, person);
      await markHandled(tx, settle.map((row) => row.id), false);
      if (toSend.length === 0) return { handled: settle.length } as const;
      const frequency = frequencyOf(person.digest);
      const lastSent = person.last_sent ? new Date(person.last_sent) : null;
      if (!emailDue({ frequency, now, lastSentAt: lastSent, timeZone: person.timezone })) return { handled: settle.length } as const;

      const email = renderNotificationEmail({
        app: 'Projects',
        recipientName: person.name,
        orgName: person.org_name,
        lines: toSend.map((row) => ({ title: row.title, detail: row.body, url: absolute(base, row.url) })),
        inboxUrl: `${base}/inbox`,
        settingsUrl: `${base}/settings?section=profile`,
        frequency,
      });
      const ids = toSend.map((row) => row.id);
      const result = await send({
        to: person.email ?? '',
        subject: email.subject,
        html: email.html,
        text: email.text,
        dedupeKey: `pm-notifications:${userId}:${[...ids].sort().join(',')}`,
      });
      if (result.ok) {
        await markHandled(tx, ids, true);
        return { handled: settle.length + ids.length, sent: true } as const;
      }
      // A bad address or message never works: set it aside. Retry and setup errors wait for the next run.
      if (result.kind === 'fatal') await markHandled(tx, ids, false);
      console.warn('[projects] notification email failed', result.kind, result.error);
      return { handled: settle.length + (result.kind === 'fatal' ? ids.length : 0), failed: true, config: result.kind === 'config' ? result.error : undefined } as const;
    });
    if (!outcome) continue;
    handled += outcome.handled;
    if ('sent' in outcome) {
      sent += 1;
      await sleep(SEND_GAP_MS);
    }
    if ('failed' in outcome) {
      failed += 1;
      if (outcome.config) stopped = outcome.config;
    }
  }
  return { sent, failed, handled, ...(stopped ? { stopped } : {}) };
}
