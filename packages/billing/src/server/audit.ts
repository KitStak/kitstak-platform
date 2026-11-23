/**
 * The billing audit log (docs/billing/CONTRACTS.md section 11.9). Every billing write records who did
 * it and one plain sentence a customer can read. The activity page lists these rows.
 */
import { and, desc, eq, lt } from 'drizzle-orm';
import { billingAuditLog } from '@kitstak/db/schema';
import type { BillingActor, BillingDb, BillingReadDb } from './db';

export type AuditAction =
  | 'trial.started'
  | 'trial.products_changed'
  | 'cart.saved'
  | 'checkout.started'
  | 'checkout.expired'
  | 'plan.started'
  | 'plan.changed'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.retried'
  | 'card.updated'
  | 'cancel.scheduled'
  | 'cancel.undone'
  | 'pause.scheduled'
  | 'pause.undone'
  | 'plan.paused'
  | 'plan.resumed'
  | 'plan.ended'
  | 'profile.updated'
  | 'manager.added'
  | 'manager.removed'
  | 'email.sent'
  | 'signup.guided_requested'
  | 'test.tool';

export interface AuditEntry {
  readonly orgId: string;
  readonly actor: BillingActor;
  readonly action: AuditAction;
  readonly summary: string;
  readonly data?: Record<string, unknown>;
  readonly eventId?: string;
}

export async function recordAudit(db: Pick<BillingDb, 'insert'>, entry: AuditEntry): Promise<void> {
  await db.insert(billingAuditLog).values({
    orgId: entry.orgId,
    actorUserId: entry.actor.userId,
    actorLabel: entry.actor.label,
    action: entry.action,
    summary: entry.summary,
    data: entry.data ?? {},
    eventId: entry.eventId ?? null,
  });
}

export interface AuditRow {
  readonly id: string;
  readonly at: Date;
  readonly actorLabel: string;
  readonly action: AuditAction;
  readonly summary: string;
  readonly data: Record<string, unknown>;
}

export async function listAuditLog(
  db: BillingReadDb,
  input: { orgId: string; limit?: number; before?: Date },
): Promise<readonly AuditRow[]> {
  const limit = Math.min(Math.max(Math.round(input.limit ?? 50), 1), 200);
  const found = await db
    .select({
      id: billingAuditLog.id,
      at: billingAuditLog.createdAt,
      actorLabel: billingAuditLog.actorLabel,
      action: billingAuditLog.action,
      summary: billingAuditLog.summary,
      data: billingAuditLog.data,
    })
    .from(billingAuditLog)
    .where(
      input.before
        ? and(eq(billingAuditLog.orgId, input.orgId), lt(billingAuditLog.createdAt, input.before))
        : eq(billingAuditLog.orgId, input.orgId),
    )
    .orderBy(desc(billingAuditLog.createdAt), desc(billingAuditLog.id))
    .limit(limit);
  return found.map((row) => ({ ...row, action: row.action as AuditAction }));
}
