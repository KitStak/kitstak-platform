/**
 * Security audit trail (`audit_log`). Append-only; failures to write are logged but never
 * break the user's request (the primary action already succeeded or failed on its own).
 */
import { db, type Executor } from '@/server/db';
import { auditLog } from '@/server/db/schema';
import { logger } from '@/server/logger';

export interface AuditEvent {
  readonly orgId: string;
  readonly actorId: string | null;
  /** Dotted action name, e.g. `member.invited`, `board.deleted`, `auth.forbidden`. */
  readonly action: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly requestId?: string;
  readonly metadata?: Record<string, unknown>;
}

export async function recordAudit(event: AuditEvent, executor: Executor = db): Promise<void> {
  try {
    await executor.insert(auditLog).values({
      orgId: event.orgId,
      actorId: event.actorId,
      action: event.action,
      targetType: event.targetType ?? null,
      targetId: event.targetId ?? null,
      ipAddress: event.ipAddress ?? null,
      userAgent: event.userAgent ? event.userAgent.slice(0, 512) : null,
      requestId: event.requestId ?? null,
      metadata: event.metadata ?? {},
    });
  } catch (error) {
    logger.error('audit.write_failed', { action: event.action, orgId: event.orgId, error });
  }
}
