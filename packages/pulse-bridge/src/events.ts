/**
 * The one write a sibling app makes into Pulse: a note in `pulse.bridge_events` that a record
 * changed (a work order moved, a deal was won, time was logged on a project). Pulse reads the
 * inbox on its next page load and on its cron tick and refreshes that record.
 *
 * Fire and forget by design: this never throws, so a Pulse problem can never break a CRM, WMS
 * or Projects write. It does nothing when Pulse is not installed. It runs in its own nested
 * transaction (a SAVEPOINT inside a host transaction), so a failure rolls back only itself.
 * A burst of changes to one record collapses into one waiting event.
 */
import { sql } from 'drizzle-orm';
import { isUuid, pulseAvailability, queryOne, type BridgeExecutor } from './executor';
import { BRIDGE_EVENT_KINDS, type BridgeEventInput } from './types';

export async function emitBridgeEvent(db: BridgeExecutor, org: { readonly orgId: string }, event: BridgeEventInput): Promise<{ queued: boolean }> {
  const targetId = (event.targetId ?? '').trim();
  if (!isUuid(org.orgId) || !targetId || targetId.length > 64) return { queued: false };
  if (!(BRIDGE_EVENT_KINDS as readonly string[]).includes(event.kind)) return { queued: false };
  try {
    const availability = await pulseAvailability(db);
    if (!availability.installed || !availability.events) return { queued: false };
    const payload = JSON.stringify(event.payload ?? {});
    return await db.transaction(async (tx) => {
      const waiting = await queryOne<{ id: string }>(
        tx,
        sql`update pulse.bridge_events set payload = ${payload}::jsonb, updated_at = now()
             where id = (select id from pulse.bridge_events
                          where org_id = ${org.orgId}::uuid and kind = ${event.kind} and target_id = ${targetId}
                            and processed_at is null and claimed_at is null
                          order by created_at limit 1)
             returning id::text as id`,
      );
      if (!waiting) {
        await tx.execute(
          sql`insert into pulse.bridge_events (org_id, kind, target_id, payload) values (${org.orgId}::uuid, ${event.kind}, ${targetId}, ${payload}::jsonb)`,
        );
      }
      return { queued: true };
    });
  } catch {
    return { queued: false };
  }
}
