/**
 * Notification emails. The scheduler (GET /api/v1/cron/notification-emails, every 5 minutes) calls
 * `deliverNotificationEmails`.
 *
 * For each person with unhandled notifications:
 *   1. Rows they already read, and events whose Email switch is off (Profile, Notifications), are
 *      marked handled.
 *   2. People who never signed in, left the org, or chose "Never email me" have every row marked
 *      handled, so a first sign in does not bring a pile of old mail.
 *   3. If their next email is due (email frequency and quiet hours), one email lists what is left.
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
import { describeNotification, notificationHref } from '@/features/notifications/describe';
import { db, type Executor } from '@/server/db';
import { appUrl } from '@/server/env';
import { defaultChannels, EVENT_FOR_KIND, type ProfilePrefs } from './admin-contracts';
import { readOrgMetadata } from './admin-org';
import { profileFor } from './admin-policy';
import type { NotificationDto, NotificationKind } from './contracts/dto';

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

export type PendingRow = {
  readonly id: string;
  readonly kind: string;
  readonly board_id: string | null;
  readonly board_name: string | null;
  readonly item_id: string | null;
  readonly item_name: string | null;
  readonly update_id: string | null;
  readonly actor_id: string | null;
  readonly actor_name: string | null;
  readonly payload: Record<string, unknown> | null;
  readonly read_at: Date | null;
  readonly created_at: Date;
};

type Person = {
  readonly email: string | null;
  readonly name: string | null;
  readonly timezone: string | null;
  readonly org_name: string;
  readonly org_slug: string;
  readonly member: boolean;
  readonly active: boolean;
  readonly last_sent: Date | null;
};

/** True when this person's settings email this kind. */
export function emailsKind(prefs: ProfilePrefs, kind: string): boolean {
  const event = EVENT_FOR_KIND[kind];
  if (!event) return false;
  return (prefs.notifications[event] ?? defaultChannels(event)).email;
}

/** Splits locked rows into the ones to email and the ones to set aside. Pure, for tests. */
export function sortRows(
  rows: readonly PendingRow[],
  person: Pick<Person, 'email' | 'member' | 'active'>,
  prefs: ProfilePrefs,
): { send: PendingRow[]; settle: PendingRow[] } {
  const allowed = Boolean(person.email) && person.member && person.active && prefs.emailDigest !== 'off';
  if (!allowed) return { send: [], settle: [...rows] };
  const send: PendingRow[] = [];
  const settle: PendingRow[] = [];
  for (const row of rows) {
    if (row.read_at || !emailsKind(prefs, row.kind)) settle.push(row);
    else send.push(row);
  }
  return { send, settle };
}

function toDto(row: PendingRow): NotificationDto {
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    actor: row.actor_id ? { id: row.actor_id, name: row.actor_name ?? 'Someone', email: '', image: null, title: null } : null,
    boardId: row.board_id,
    boardName: row.board_name,
    itemId: row.item_id,
    itemName: row.item_name,
    updateId: row.update_id,
    payload: row.payload ?? {},
    readAt: null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** One email line per notification, in the same words as the inbox. */
export function lineFor(row: PendingRow, base: string, orgSlug: string) {
  const entry = toDto(row);
  const description = describeNotification(entry);
  const href = notificationHref(orgSlug, entry);
  return { title: description.label, detail: description.preview, url: href ? `${base}${href}` : null };
}

async function markHandled(executor: Executor, ids: readonly string[], emailed: boolean): Promise<void> {
  if (ids.length === 0) return;
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  await executor.execute(sql`
    update crm.notifications
    set email_handled_at = now()${emailed ? sql`, emailed_at = now()` : sql``}
    where id in (${list})`);
}

export async function deliverNotificationEmails(options: DeliverOptions = {}): Promise<EmailRunResult> {
  if (!(options.ready ?? resendReady())) return { sent: 0, failed: 0, handled: 0, stopped: 'Email is not set up (RESEND_API_KEY, EMAIL_FROM).' };
  const now = options.now ?? new Date();
  const send = options.send ?? ((message) => sendWithResend(message));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const base = appUrl();

  const recipients = await db.execute<{ org_id: string; user_id: string }>(sql`
    select distinct org_id::text as org_id, user_id::text as user_id
    from crm.notifications
    where email_handled_at is null
    limit ${RECIPIENTS_PER_RUN}`);

  const prefsByOrg = new Map<string, Awaited<ReturnType<typeof readOrgMetadata>>>();
  let sent = 0;
  let failed = 0;
  let handled = 0;
  let stopped: string | undefined;
  for (const { org_id: orgId, user_id: userId } of recipients.rows) {
    if (stopped) break;
    if (!prefsByOrg.has(orgId)) prefsByOrg.set(orgId, await readOrgMetadata(db, orgId));
    const prefs = profileFor(prefsByOrg.get(orgId)!, userId);
    const outcome = await db.transaction(async (tx) => {
      const locked = await tx.execute<PendingRow>(sql`
        select n.id::text as id, n.kind::text as kind, n.board_id::text as board_id, b.name as board_name,
          n.item_id::text as item_id, i.name as item_name, n.update_id::text as update_id,
          n.actor_id::text as actor_id, a.name as actor_name, n.payload, n.read_at, n.created_at
        from crm.notifications n
        left join crm.boards b on b.id = n.board_id
        left join crm.items i on i.id = n.item_id
        left join core."user" a on a.id = n.actor_id
        where n.org_id = ${orgId} and n.user_id = ${userId} and n.email_handled_at is null
        order by n.created_at
        limit ${ROWS_PER_EMAIL}
        for update of n skip locked`);
      if (locked.rows.length === 0) return null;
      const people = await tx.execute<Person>(sql`
        select u.email, u.name, u.timezone, o.name as org_name, o.slug as org_slug,
          exists (select 1 from core.member m where m.organization_id = o.id and m.user_id = u.id and m.role not like 'deactivated:%') as member,
          (exists (select 1 from core.session s where s.user_id = u.id)
            or exists (select 1 from crm.notifications r where r.user_id = u.id and (r.read_at is not null or r.emailed_at is not null))) as active,
          (select max(x.emailed_at) from crm.notifications x where x.org_id = o.id and x.user_id = u.id) as last_sent
        from core."user" u, core.organization o
        where u.id = ${userId} and o.id = ${orgId}`);
      const person = people.rows[0];
      if (!person) {
        await markHandled(tx, locked.rows.map((row) => row.id), false);
        return { handled: locked.rows.length } as const;
      }
      const { send: toSend, settle } = sortRows(locked.rows, person, prefs);
      await markHandled(tx, settle.map((row) => row.id), false);
      if (toSend.length === 0) return { handled: settle.length } as const;
      const frequency: EmailFrequency = prefs.emailDigest;
      const lastSent = person.last_sent ? new Date(person.last_sent) : null;
      const due = emailDue({ frequency, now, lastSentAt: lastSent, timeZone: person.timezone, quietHours: prefs.quietHours });
      if (!due) return { handled: settle.length } as const;

      const email = renderNotificationEmail({
        app: 'CRM',
        recipientName: person.name,
        orgName: person.org_name,
        lines: toSend.map((row) => lineFor(row, base, person.org_slug)),
        inboxUrl: `${base}/${person.org_slug}/inbox`,
        settingsUrl: `${base}/${person.org_slug}/settings/profile?tab=notifications`,
        frequency,
      });
      const ids = toSend.map((row) => row.id);
      const result = await send({
        to: person.email ?? '',
        subject: email.subject,
        html: email.html,
        text: email.text,
        dedupeKey: `crm-notifications:${userId}:${[...ids].sort().join(',')}`,
      });
      if (result.ok) {
        await markHandled(tx, ids, true);
        return { handled: settle.length + ids.length, sent: true } as const;
      }
      // A bad address or message never works: set it aside. Retry and setup errors wait for the next run.
      if (result.kind === 'fatal') await markHandled(tx, ids, false);
      console.warn('[crm] notification email failed', result.kind, result.error);
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
