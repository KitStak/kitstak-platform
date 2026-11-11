/**
 * Security audit log writer (`audit_log`): logins, CSRF failures, permission denials,
 * password and session events. Business edits go to `change_log` (F5 `change-log.ts`).
 *
 * Writes are best-effort: a failing audit insert is logged but never fails the request.
 * The insert runs in a savepoint (`bestEffort`), so a failure cannot abort an enclosing
 * Postgres transaction.
 */
import { auditLog } from "@/server/db/schema";
import type { AppDb } from "@/server/api/db";
import { bestEffort } from "@/server/db/sql";
import { log } from "@/server/log";

export interface AuditEntry {
  readonly action: string;
  readonly entity: string;
  readonly entityId: string;
  readonly userId?: string | null;
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly outcome?: "success" | "failure";
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export async function writeAudit(db: AppDb, entry: AuditEntry, now: Date = new Date()): Promise<void> {
  const result = await bestEffort(db, async (sp) => {
    await sp.insert(auditLog).values({
      userId: entry.userId ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      detail: entry.detail ? JSON.stringify(entry.detail) : null,
      at: now.toISOString(),
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ? entry.userAgent.slice(0, 400) : null,
      outcome: entry.outcome ?? "success",
    });
  });
  if (!result.ok) log.error("audit write failed", { component: "audit", action: entry.action, err: result.error });
}
