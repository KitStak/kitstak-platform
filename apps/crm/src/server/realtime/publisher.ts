/**
 * Publishes realtime events through Postgres NOTIFY. When called inside a transaction the
 * notification is delivered only on COMMIT (and dropped on rollback) — exactly the semantics
 * we want for invalidation hints.
 */
import { sql } from 'drizzle-orm';
import type { Executor } from '@/server/db';
import { logger } from '@/server/logger';
import { REALTIME_CHANNEL, type RealtimeEvent, type RealtimeEventType } from './events';

const MAX_IDS = 100;
const MAX_USER_IDS = 50; // ids + userIds stay well under the 8000-byte NOTIFY limit

export interface PublishInput {
  readonly type: RealtimeEventType;
  readonly orgId: string;
  readonly boardId?: string | null;
  readonly ids?: readonly string[];
  readonly userIds?: readonly string[];
  readonly actorId?: string | null;
}

export function buildEvent(input: PublishInput): RealtimeEvent {
  return {
    type: input.type,
    orgId: input.orgId,
    boardId: input.boardId ?? null,
    ids: [...new Set(input.ids ?? [])].slice(0, MAX_IDS),
    userIds: [...new Set(input.userIds ?? [])].slice(0, MAX_USER_IDS),
    actorId: input.actorId ?? null,
    at: new Date().toISOString(),
  };
}

export async function publish(executor: Executor, input: PublishInput): Promise<void> {
  const payload = JSON.stringify(buildEvent(input));
  try {
    await executor.execute(sql`select pg_notify(${REALTIME_CHANNEL}, ${payload})`);
  } catch (error) {
    // Realtime is best-effort; never fail the user's mutation because of it.
    logger.warn('realtime.publish_failed', { type: input.type, error });
  }
}
