/**
 * The email outbox, write side (docs/billing/CONTRACTS.md sections 11.9 and 13). Foundation only
 * queues rows; the lifecycle lane renders and sends them. `dedupe_key` makes every email go out once.
 */
import { and, eq } from 'drizzle-orm';
import { billingAccounts, billingEmails, billingManagers, member, user } from '@kitstak/db/schema';
import type { EmailPayloads, EmailTemplateId } from '../email-types';
import type { BillingDb, BillingReadDb } from './db';
import { isActiveRole, roleParts } from './roles';

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
      payload: input.payload as unknown as Record<string, unknown>,
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
    if (roleParts(row.role).includes('owner') || managers.has(row.userId)) {
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
