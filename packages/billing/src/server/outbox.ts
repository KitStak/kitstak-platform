/**
 * The email outbox, write side (docs/billing/CONTRACTS.md sections 11.9 and 13). Foundation only
 * queues rows; the lifecycle lane renders and sends them. `dedupe_key` makes every email go out once.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { billingAccounts, billingEmails, billingManagers, member, user } from '@kitstak/db/schema';
import type { EmailPayloads, EmailTemplateId } from '../email-types';
import type { BillingDb, BillingReadDb } from './db';
import { hasBillingRole, isActiveRole, roleParts } from './roles';

/**
 * Every email about an organization carries that organization's id in its payload (review round
 * 4), so every link in it opens the Portal for that organization. Written here, in the one place
 * every email passes, so no sender can forget it. Emails with no organization (codes) are left as
 * they are.
 */
export function payloadWithOrg(payload: Record<string, unknown>, orgId: string | null): Record<string, unknown> {
  if (!orgId || typeof payload.portalUrl !== 'string' || typeof payload.orgId === 'string') return payload;
  return { ...payload, orgId };
}

export async function enqueueEmail<T extends EmailTemplateId>(
  db: Pick<BillingDb, 'insert'>,
  input: {
    orgId: string | null;
    to: string;
    template: T;
    payload: EmailPayloads[T];
    dedupeKey: string;
    sendAfter?: Date;
  },
): Promise<void> {
  const to = input.to.trim().toLowerCase();
  if (to === '') return;
  await db
    .insert(billingEmails)
    .values({
      orgId: input.orgId,
      toEmail: to,
      template: input.template,
      payload: payloadWithOrg(input.payload as unknown as Record<string, unknown>, input.orgId),
      dedupeKey: input.dedupeKey,
      ...(input.sendAfter ? { sendAfter: input.sendAfter } : {}),
    })
    .onConflictDoNothing({ target: billingEmails.dedupeKey });
}

/** Billing email if set, plus every owner and billing manager. Lower case, no repeats. */
export async function billingRecipients(db: BillingReadDb, orgId: string): Promise<readonly string[]> {
  const out = new Set<string>();
  const [account] = await db
    .select({ billingEmail: billingAccounts.billingEmail })
    .from(billingAccounts)
    .where(eq(billingAccounts.orgId, orgId));
  const billingEmail = account?.billingEmail?.trim().toLowerCase();
  if (billingEmail) out.add(billingEmail);

  const members = await db
    .select({ userId: member.userId, role: member.role, email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId));
  const managerRows = await db
    .select({ userId: billingManagers.userId })
    .from(billingManagers)
    .where(and(eq(billingManagers.orgId, orgId)));
  const managers = new Set(managerRows.map((row) => row.userId));
  for (const row of members) {
    if (!isActiveRole(row.role)) continue;
    if (roleParts(row.role).includes('owner') || managers.has(row.userId) || hasBillingRole(row.role)) {
      const email = row.email.trim().toLowerCase();
      if (email) out.add(email);
    }
  }
  return [...out];
}

/** Queues one email per billing recipient. The dedupe key gets the address added to it. */
export async function enqueueForBillingRecipients<T extends EmailTemplateId>(
  db: BillingDb,
  input: { orgId: string; template: T; payload: EmailPayloads[T]; dedupeKey: string; sendAfter?: Date },
): Promise<number> {
  const recipients = await billingRecipients(db, input.orgId);
  for (const to of recipients) {
    await enqueueEmail(db, { ...input, to, dedupeKey: `${input.dedupeKey}:${to}` });
  }
  return recipients.length;
}

/**
 * A person fixed a typo in their own, never verified, email (the Portal's "Change email"). Mail
 * that was queued for the old address must not go to it: a stranger's mailbox would get the
 * organization's name and its trial dates, and the right address would get nothing (review round 5).
 *
 *  - mail about one of this person's organizations that still waits in the outbox moves to the new
 *    address,
 *  - a code that still waits for the old address is of no use to anyone and is not sent,
 *  - a welcome email that already left for the old address is queued once more, for the new one.
 *
 * Only rows addressed to exactly the old address are touched. Mail to other people of the
 * organization stays as it is. Returns what it did, for the caller's log line.
 */
export async function moveQueuedEmails(
  db: Pick<BillingDb, 'select' | 'insert' | 'update'>,
  input: { orgIds: readonly string[]; from: string; to: string },
): Promise<{ moved: number; skippedCodes: number; resentWelcome: number }> {
  const from = input.from.trim().toLowerCase();
  const to = input.to.trim().toLowerCase();
  if (from === '' || to === '' || from === to) return { moved: 0, skippedCodes: 0, resentWelcome: 0 };

  const codes = await db
    .update(billingEmails)
    .set({ status: 'skipped', error: 'The address was changed before this code was sent.' })
    .where(and(eq(billingEmails.toEmail, from), eq(billingEmails.status, 'queued'), isNull(billingEmails.orgId), inArray(billingEmails.template, ['verify_email', 'reset_password'])))
    .returning({ id: billingEmails.id });
  if (input.orgIds.length === 0) return { moved: 0, skippedCodes: codes.length, resentWelcome: 0 };

  const orgIds = [...input.orgIds];
  const moved = await db
    .update(billingEmails)
    .set({ toEmail: to })
    .where(and(eq(billingEmails.toEmail, from), eq(billingEmails.status, 'queued'), inArray(billingEmails.orgId, orgIds)))
    .returning({ id: billingEmails.id });

  const gone = await db
    .select({ orgId: billingEmails.orgId, payload: billingEmails.payload, dedupeKey: billingEmails.dedupeKey })
    .from(billingEmails)
    .where(and(eq(billingEmails.toEmail, from), eq(billingEmails.status, 'sent'), eq(billingEmails.template, 'welcome'), inArray(billingEmails.orgId, orgIds)));
  let resentWelcome = 0;
  for (const row of gone) {
    const again = await db
      .insert(billingEmails)
      .values({ orgId: row.orgId, toEmail: to, template: 'welcome', payload: row.payload, dedupeKey: `${row.dedupeKey}:moved:${to}` })
      .onConflictDoNothing({ target: billingEmails.dedupeKey })
      .returning({ id: billingEmails.id });
    resentWelcome += again.length;
  }
  return { moved: moved.length, skippedCodes: codes.length, resentWelcome };
}
