/**
 * Automation hooks: CRM / WMS call these when a record changes in a way Projects cares about
 * (deal stage, order shipped…). The cached status on every link to the record is refreshed at
 * once (so chips in Projects are live), and when tasks are linked an event is queued in
 * pm.integration_events for Projects to turn into automation runs ("When the linked deal moves
 * to Won, mark this task done").
 *
 * Fire-and-forget by design: these never throw, so a Projects problem can never break a CRM
 * or WMS write. Call them after the host transaction commits (or inside it, to make the event
 * atomic with the change — both are safe).
 */
import { sql } from 'drizzle-orm';
import { isUuid, pmAvailability, query, queryOne, storedLinkPath, type BridgeExecutor } from './executor';
import type { RecordStatusEvent } from './types';

const norm = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase();

export interface EmitResult {
  /** Links whose cached status/title were refreshed. */
  readonly linksUpdated: number;
  /** An automation event was queued (some task is linked and the status really changed). */
  readonly queued: boolean;
}

const NOTHING: EmitResult = { linksUpdated: 0, queued: false };

export async function emitRecordStatusChange(db: BridgeExecutor, event: RecordStatusEvent): Promise<EmitResult> {
  if (!isUuid(event.orgId) || !event.target.id) return NOTHING;
  try {
    const availability = await pmAvailability(db);
    if (!availability.installed) return NOTHING;
    // Own (nested) transaction: inside a host transaction this is a SAVEPOINT, so a failure here
    // rolls back only the bridge's statements and never aborts the CRM/WMS write around it.
    return await db.transaction(async (tx) => {
      const links = await query<{ id: string; task_id: string | null; cached_status: string | null }>(
        tx,
        sql`select id, task_id, cached_status from pm.integration_links
             where org_id = ${event.orgId}::uuid and target_type = ${event.target.type} and target_id = ${event.target.id}`,
      );
      if (links.length === 0) return NOTHING;
      const previous =
        event.previousStatus !== undefined
          ? event.previousStatus
          : (links.find((link) => norm(link.cached_status) !== norm(event.status))?.cached_status ?? links[0]?.cached_status ?? null);
      const updated = await query<{ id: string }>(
        tx,
        sql`update pm.integration_links
               set cached_status = ${event.status},
                   cached_title = coalesce(${event.title ?? null}, cached_title),
                   cached_url = coalesce(${storedLinkPath(event.url)}, cached_url),
                   cached_at = now()
             where org_id = ${event.orgId}::uuid and target_type = ${event.target.type} and target_id = ${event.target.id}
             returning id`,
      );
      const hasTasks = links.some((link) => link.task_id !== null);
      if (!availability.events || !hasTasks || norm(previous) === norm(event.status)) {
        return { linksUpdated: updated.length, queued: false };
      }
      await tx.execute(
        sql`insert into pm.integration_events (org_id, source, kind, target_type, target_id, title, before_status, after_status, url, actor_id)
            values (${event.orgId}::uuid, ${event.source}, 'record_status_changed', ${event.target.type}, ${event.target.id},
                    ${event.title ?? null}, ${previous}, ${event.status}, ${event.url ?? null},
                    ${event.actorId && isUuid(event.actorId) ? event.actorId : null}::uuid)`,
      );
      return { linksUpdated: updated.length, queued: true };
    });
  } catch (error) {
    console.warn('[pm-bridge] emitRecordStatusChange failed', error);
    return NOTHING;
  }
}

/** Org id for a slug (WMS is single-tenant and belongs to the platform org). */
export async function orgIdForSlug(db: BridgeExecutor, slug: string): Promise<string | null> {
  try {
    const row = await queryOne<{ id: string }>(db, sql`select id from core.organization where slug = ${slug} limit 1`);
    return row?.id ?? null;
  } catch {
    return null;
  }
}
