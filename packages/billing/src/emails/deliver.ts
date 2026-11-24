/**
 * The outbox, send side (docs/billing/CONTRACTS.md section 13.2). Rows are queued by
 * `enqueueEmail`. Here they are claimed, rendered, sent and marked.
 *
 * How an email goes out exactly once:
 *  1. A row is claimed with one UPDATE that skips rows another worker holds (FOR UPDATE SKIP
 *     LOCKED). The claim adds one to `attempts` and moves `send_after` forward, so a crashed
 *     worker's row comes back by itself a few minutes later.
 *  2. The send carries an idempotency key made from the row's dedupe key, so a retry after a lost
 *     answer does not send a second copy.
 *  3. The row is marked `sent`. After 3 tries that did not work it is marked `failed`.
 *
 * No database transaction is held open while a network call runs.
 */
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { billingEmails } from '@kitstak/db/schema';
import type { EmailTemplateId } from '../email-types';
import { recordAudit } from '../server/audit';
import { SYSTEM_ACTOR, errorText, logBilling, rows, type BillingDb, type BillingReadDb } from '../server/db';
import { payloadWithOrg } from '../server/outbox';
import { resolveEmailProvider, sendWithResend, type EmailProvider, type FetchLike } from './provider';
import { CODE_TEMPLATES, emailAuditSummary, isEmailTemplateId, renderEmail } from './render';
import type { RenderedEmail } from './layout';

export const MAX_EMAIL_ATTEMPTS = 3;
/** How long a claimed row is held before it may be tried again. */
const RETRY_AFTER_MINUTES = 5;
/** Resend allows 2 requests a second by default. Stay just under it. */
const RESEND_GAP_MS = 550;

export interface DeliverOptions {
  readonly limit?: number;
  readonly now?: Date;
  /** For tests. Default: process.env. */
  readonly env?: NodeJS.ProcessEnv;
  /** For tests. Default: the global fetch. */
  readonly fetch?: FetchLike;
  /** For tests on a shared database: only rows whose dedupe key starts with this are touched. */
  readonly keyPrefix?: string;
}

interface ClaimedRow {
  readonly id: string;
  readonly org_id: string | null;
  readonly to_email: string;
  readonly template: string;
  readonly payload: unknown;
  readonly dedupe_key: string;
  readonly attempts: number;
}

type Outcome = 'sent' | 'failed' | 'retry' | 'skipped' | 'stop';

function payloadObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * The database clock has microseconds and may run a moment ahead of this server. A row queued "now"
 * must count as due in the same breath, so due means up to one second from now.
 */
const DUE_GRACE_MS = 1000;

function dueBy(now: Date): Date {
  return new Date(now.getTime() + DUE_GRACE_MS);
}

function retryAt(now: Date): Date {
  return new Date(now.getTime() + RETRY_AFTER_MINUTES * 60_000);
}

/** A LIKE pattern for "starts with". The escape keeps "%" and "_" in a key from acting as wildcards. */
function startsWithPattern(prefix: string | undefined): string {
  return `${(prefix ?? '').replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

async function claimDue(db: BillingDb, limit: number, now: Date, keyPrefix?: string): Promise<ClaimedRow[]> {
  const result = await db.execute(sql`
    UPDATE "core"."billing_emails" AS e
       SET "attempts" = e."attempts" + 1,
           "send_after" = ${retryAt(now).toISOString()}::timestamptz
     WHERE e."id" IN (
             SELECT "id" FROM "core"."billing_emails"
              WHERE "status" = 'queued' AND "send_after" <= ${dueBy(now).toISOString()}::timestamptz
                AND "dedupe_key" LIKE ${startsWithPattern(keyPrefix)}
              ORDER BY "send_after", "created_at"
              LIMIT ${limit}
                FOR UPDATE SKIP LOCKED)
       AND e."status" = 'queued'
    RETURNING e."id", e."org_id", e."to_email", e."template", e."payload", e."dedupe_key", e."attempts"
  `);
  return rows<ClaimedRow>(result);
}

async function claimOne(db: BillingDb, id: string, now: Date): Promise<ClaimedRow | null> {
  const result = await db.execute(sql`
    UPDATE "core"."billing_emails" AS e
       SET "attempts" = e."attempts" + 1,
           "send_after" = ${retryAt(now).toISOString()}::timestamptz
     WHERE e."id" = ${id}::uuid
       AND e."status" = 'queued'
       AND (e."attempts" = 0 OR e."send_after" <= ${dueBy(now).toISOString()}::timestamptz)
    RETURNING e."id", e."org_id", e."to_email", e."template", e."payload", e."dedupe_key", e."attempts"
  `);
  return rows<ClaimedRow>(result)[0] ?? null;
}

/** A sent code is wiped from the payload, so the outbox table never keeps a usable code. */
function payloadAfterSend(template: EmailTemplateId, payload: Record<string, unknown>): Record<string, unknown> {
  if (!CODE_TEMPLATES.includes(template)) return payload;
  const { code: _wiped, ...rest } = payload;
  return rest;
}

async function markSent(
  db: BillingDb,
  row: ClaimedRow,
  template: EmailTemplateId,
  email: RenderedEmail,
  sent: { provider: EmailProvider; messageId: string | null; keepBody: boolean; now: Date },
): Promise<void> {
  const payload = payloadObject(row.payload);
  await db
    .update(billingEmails)
    .set({
      status: 'sent',
      provider: sent.provider,
      providerMessageId: sent.messageId,
      subject: email.subject,
      // The rendered body is stored only by the dev outbox. With a real provider the mailbox has it.
      html: sent.keepBody ? email.html : null,
      bodyText: sent.keepBody ? email.text : null,
      payload: payloadAfterSend(template, payload),
      error: null,
      sentAt: sent.now,
    })
    .where(eq(billingEmails.id, row.id));

  const summary = row.org_id ? emailAuditSummary(template, row.to_email) : null;
  if (row.org_id && summary) {
    try {
      const invoiceId = typeof payload.invoiceId === 'string' ? payload.invoiceId : null;
      await recordAudit(db, {
        orgId: row.org_id,
        actor: SYSTEM_ACTOR,
        action: 'email.sent',
        summary,
        data: { emailId: row.id, template, to: row.to_email, ...(invoiceId ? { invoiceId } : {}) },
      });
    } catch (error) {
      // The email went out. A missing log line must not make it go out again.
      logBilling('warn', 'email sent but the activity row was not written', { emailId: row.id, error: errorText(error) });
    }
  }
}

async function markProblem(
  db: BillingDb,
  row: ClaimedRow,
  change: { status: 'queued' | 'failed' | 'skipped'; error: string; giveBackAttempt?: boolean },
): Promise<void> {
  await db
    .update(billingEmails)
    .set({
      status: change.status,
      error: change.error.slice(0, 500),
      ...(change.giveBackAttempt ? { attempts: Math.max(0, row.attempts - 1) } : {}),
    })
    .where(eq(billingEmails.id, row.id));
}

async function deliverClaimed(
  db: BillingDb,
  row: ClaimedRow,
  provider: Exclude<EmailProvider, 'none'>,
  options: { now: Date; env?: NodeJS.ProcessEnv; fetch?: FetchLike },
): Promise<{ outcome: Outcome; error?: string }> {
  if (!isEmailTemplateId(row.template)) {
    const error = `Unknown email template "${row.template}".`;
    await markProblem(db, row, { status: 'skipped', error });
    return { outcome: 'skipped', error };
  }
  const template = row.template;

  let email: RenderedEmail;
  try {
    email = renderEmail(template, payloadObject(row.payload) as never);
  } catch (error) {
    // A payload that cannot be rendered will not render on a second try either.
    const text = errorText(error);
    await markProblem(db, row, { status: 'failed', error: text });
    logBilling('error', 'email could not be rendered', { emailId: row.id, template, error: text });
    return { outcome: 'failed', error: text };
  }

  if (provider === 'outbox') {
    await markSent(db, row, template, email, { provider, messageId: null, keepBody: true, now: options.now });
    return { outcome: 'sent' };
  }

  const result = await sendWithResend(
    { to: row.to_email, email, dedupeKey: row.dedupe_key },
    { ...(options.env ? { env: options.env } : {}), ...(options.fetch ? { fetch: options.fetch } : {}) },
  );
  if (result.ok) {
    await markSent(db, row, template, email, { provider, messageId: result.messageId, keepBody: false, now: options.now });
    return { outcome: 'sent' };
  }
  if (result.kind === 'config') {
    // Not this email's fault. It stays queued and the try does not count.
    await markProblem(db, row, { status: 'queued', error: result.error, giveBackAttempt: true });
    return { outcome: 'stop', error: result.error };
  }
  if (result.kind === 'fatal' || row.attempts >= MAX_EMAIL_ATTEMPTS) {
    await markProblem(db, row, { status: 'failed', error: result.error });
    logBilling('error', 'email failed for good', { emailId: row.id, template, attempts: row.attempts, error: result.error });
    return { outcome: 'failed', error: result.error };
  }
  await markProblem(db, row, { status: 'queued', error: result.error });
  return { outcome: 'retry', error: result.error };
}

async function countDue(db: BillingReadDb, now: Date, keyPrefix?: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(billingEmails)
    .where(
      and(
        eq(billingEmails.status, 'queued'),
        lte(billingEmails.sendAfter, dueBy(now)),
        sql`${billingEmails.dedupeKey} LIKE ${startsWithPattern(keyPrefix)}`,
      ),
    );
  return row?.count ?? 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends queued rows whose `send_after` has passed. Up to 3 attempts each. `skipped` counts rows that
 * were left for a later run (no provider, a setup problem) or dropped for an unknown template.
 */
export async function deliverQueuedEmails(
  db: BillingDb,
  options?: DeliverOptions,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const now = options?.now ?? new Date();
  const env = options?.env ?? process.env;
  const limit = Math.min(Math.max(Math.round(options?.limit ?? 50), 1), 200);
  const provider = resolveEmailProvider(env);

  if (provider === 'none') {
    const waiting = await countDue(db, now, options?.keyPrefix);
    if (waiting > 0) {
      logBilling('error', 'emails are waiting but no mail provider is set. Set RESEND_API_KEY and EMAIL_FROM.', {
        waiting,
      });
    }
    return { sent: 0, failed: 0, skipped: waiting };
  }

  const claimed = await claimDue(db, limit, now, options?.keyPrefix);
  const report = { sent: 0, failed: 0, skipped: 0 };
  for (let index = 0; index < claimed.length; index += 1) {
    const row = claimed[index]!;
    let outcome: Outcome;
    let error: string | undefined;
    try {
      ({ outcome, error } = await deliverClaimed(db, row, provider, {
        now,
        env,
        ...(options?.fetch ? { fetch: options.fetch } : {}),
      }));
    } catch (thrown) {
      // A database error in the middle. The claim already moved send_after, so the row returns later.
      outcome = 'retry';
      error = errorText(thrown);
      logBilling('error', 'email delivery hit an error', { emailId: row.id, error });
    }
    if (outcome === 'sent') report.sent += 1;
    else if (outcome === 'failed' || outcome === 'retry') report.failed += 1;
    else report.skipped += 1;

    if (outcome === 'stop') {
      // The provider setup is wrong. Give the rest of this batch back untouched and say so once.
      const rest = claimed.slice(index + 1);
      for (const waiting of rest) {
        await markProblem(db, waiting, { status: 'queued', error: error ?? 'Mail provider problem.', giveBackAttempt: true });
      }
      report.skipped += rest.length;
      logBilling('error', 'email delivery stopped: the mail provider refused the request', { error, waiting: rest.length + 1 });
      break;
    }
    if (provider === 'resend' && index < claimed.length - 1) await sleep(RESEND_GAP_MS);
  }
  return report;
}

/**
 * Renders and sends at once, and records the row in core.billing_emails. For codes and other mail a
 * person is waiting for. Calling it twice with the same dedupe key sends once.
 */
export async function sendEmailNow<T extends EmailTemplateId>(
  db: BillingDb,
  input: { orgId: string | null; to: string; template: T; payload: import('../email-types').EmailPayloads[T]; dedupeKey: string },
  options?: Omit<DeliverOptions, 'limit' | 'keyPrefix'>,
): Promise<{ ok: boolean; provider: EmailProvider; error?: string }> {
  const now = options?.now ?? new Date();
  const env = options?.env ?? process.env;
  const provider = resolveEmailProvider(env);
  const to = input.to.trim().toLowerCase();
  if (to === '') return { ok: false, provider, error: 'No address to send to.' };

  const inserted = await db
    .insert(billingEmails)
    .values({
      orgId: input.orgId,
      toEmail: to,
      template: input.template,
      payload: payloadWithOrg(input.payload as unknown as Record<string, unknown>, input.orgId),
      dedupeKey: input.dedupeKey,
      sendAfter: now,
    })
    .onConflictDoNothing({ target: billingEmails.dedupeKey })
    .returning({ id: billingEmails.id });

  let id = inserted[0]?.id ?? null;
  if (!id) {
    const [existing] = await db
      .select({ id: billingEmails.id, status: billingEmails.status })
      .from(billingEmails)
      .where(eq(billingEmails.dedupeKey, input.dedupeKey));
    if (!existing) return { ok: false, provider, error: 'The email could not be queued.' };
    if (existing.status === 'sent') return { ok: true, provider };
    if (existing.status !== 'queued') return { ok: false, provider, error: 'This email failed before and will not be sent again.' };
    id = existing.id;
  }

  if (provider === 'none') {
    logBilling('error', 'an email is waiting but no mail provider is set. Set RESEND_API_KEY and EMAIL_FROM.', {
      template: input.template,
    });
    return { ok: false, provider, error: 'No mail provider is set. The email stays queued.' };
  }

  const claimed = await claimOne(db, id, now);
  // Another worker holds the row right now. It is on its way.
  if (!claimed) return { ok: true, provider };

  try {
    const { outcome, error } = await deliverClaimed(db, claimed, provider, {
      now,
      env,
      ...(options?.fetch ? { fetch: options.fetch } : {}),
    });
    if (outcome === 'sent') return { ok: true, provider };
    return { ok: false, provider, ...(error ? { error } : {}) };
  } catch (thrown) {
    const error = errorText(thrown);
    logBilling('error', 'send now hit an error', { emailId: id, error });
    return { ok: false, provider, error };
  }
}

export interface OutboxRow {
  readonly id: string;
  readonly to: string;
  readonly template: EmailTemplateId;
  readonly subject: string | null;
  readonly status: string;
  readonly createdAt: Date;
  readonly sentAt: Date | null;
  readonly html: string | null;
  readonly text: string | null;
}

const outboxColumns = {
  id: billingEmails.id,
  to: billingEmails.toEmail,
  template: billingEmails.template,
  subject: billingEmails.subject,
  status: billingEmails.status,
  createdAt: billingEmails.createdAt,
  sentAt: billingEmails.sentAt,
  html: billingEmails.html,
  text: billingEmails.bodyText,
};

/** Every email, newest first. `to` narrows the list to one address. */
export async function listOutbox(db: BillingReadDb, options?: { limit?: number; to?: string }): Promise<readonly OutboxRow[]> {
  const limit = Math.min(Math.max(Math.round(options?.limit ?? 50), 1), 200);
  const to = options?.to?.trim().toLowerCase();
  const query = db.select(outboxColumns).from(billingEmails);
  const found = await (to ? query.where(eq(billingEmails.toEmail, to)) : query)
    .orderBy(desc(billingEmails.createdAt), desc(billingEmails.id))
    .limit(limit);
  return found.map((row) => ({ ...row, template: row.template as EmailTemplateId }));
}

/** One email by id, or null. */
export async function getOutboxEmail(db: BillingReadDb, id: string): Promise<OutboxRow | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const [row] = await db.select(outboxColumns).from(billingEmails).where(eq(billingEmails.id, id));
  return row ? { ...row, template: row.template as EmailTemplateId } : null;
}

/** How many emails are queued and due, and how old the oldest is. For the go live watch list. */
export async function outboxHealth(db: BillingReadDb, now: Date = new Date()): Promise<{ queued: number; failed: number; oldestQueuedAt: Date | null }> {
  const [row] = await db
    .select({
      queued: sql<number>`count(*) filter (where ${billingEmails.status} = 'queued' and ${billingEmails.sendAfter} <= ${now.toISOString()}::timestamptz)::int`,
      failed: sql<number>`count(*) filter (where ${billingEmails.status} = 'failed')::int`,
      oldest: sql<Date | string | null>`min(${billingEmails.createdAt}) filter (where ${billingEmails.status} = 'queued')`,
    })
    .from(billingEmails);
  const oldest = row?.oldest ? new Date(row.oldest) : null;
  return { queued: row?.queued ?? 0, failed: row?.failed ?? 0, oldestQueuedAt: oldest };
}
