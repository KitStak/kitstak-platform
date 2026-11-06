/**
 * Webhook outbox: item events are written as pending deliveries in the SAME transaction as the
 * item mutation, so a rolled-back change never reaches an outside system. A worker delivers
 * committed rows afterwards with bounded concurrency and exponential backoff, and auto-disables
 * a webhook after repeated consecutive failures.
 *
 * Storage: there is no queue table (schema changes are frozen), so outbox rows live in
 * `audit_log` (`action = 'webhook.outbox'`, target = webhook) and are removed once delivered or
 * given up on; every HTTP attempt is still logged as a `webhook.delivery` row.
 *
 * Worker: in-process. It drains shortly after an enqueue and then every 30 s (timer unref'd),
 * claiming rows with `FOR UPDATE SKIP LOCKED` so several app instances never double-send.
 * Rows left pending by a crash are picked up the next time the worker runs.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db as defaultDb, type Executor } from '@/server/db';
import { auditLog, webhooks } from '@/server/db/schema';
import { logger } from '@/server/logger';
import {
  deliverWebhook,
  webhookEventData,
  webhookEventsFor,
  type DeliveryPayload,
  type WebhookRow,
} from './automations-webhooks';
import type { ServiceContext } from './context';
import type { ItemEvent } from './item-events';

export const OUTBOX_ACTION = 'webhook.outbox';
/** Delay before attempt 2, 3, 4, 5 (then the delivery is given up). */
export const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;
/** Consecutive failed deliveries after which a webhook is turned off. */
export const AUTO_DISABLE_AFTER = 15;
export const DELIVERY_CONCURRENCY = 5;
const BATCH = 25;
const LOCK_MS = 60_000;
const KICK_DELAY_MS = 150;
const SWEEP_MS = 30_000;

export interface OutboxMetadata {
  readonly deliveryId: string;
  readonly event: string;
  readonly boardId: string | null;
  readonly data: Record<string, unknown>;
  readonly attempts: number;
  readonly state: 'pending' | 'sending';
  readonly nextAttemptAt: string;
  readonly lockedUntil?: string;
}

/** Next state after a failed attempt (pure; exported for tests). */
export function afterFailure(
  attempts: number,
  now: Date,
): { readonly giveUp: true } | { readonly giveUp: false; readonly nextAttemptAt: Date } {
  if (attempts >= MAX_ATTEMPTS) return { giveUp: true };
  const delay = RETRY_BACKOFF_MS[Math.max(0, attempts - 1)] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
  return { giveUp: false, nextAttemptAt: new Date(now.getTime() + delay) };
}

/** Run `task` over `items` with at most `limit` in flight (pure helper; exported for tests). */
export async function mapLimit<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await task(item as T);
    }
  });
  await Promise.all(workers);
}

// Enqueue (inside the caller's transaction) -----------------------------------------------------

/**
 * Called by `dispatchItemEvents` with the mutation's executor: rows become visible to the worker
 * only if the transaction commits. Errors are logged, never thrown (webhooks must not break edits).
 */
export async function enqueueWebhookEvents(ctx: ServiceContext, events: readonly ItemEvent[]): Promise<void> {
  try {
    const boardIds = [...new Set(events.map((event) => event.boardId))];
    if (boardIds.length === 0) return;
    const rows = await ctx.db
      .select({ id: webhooks.id, boardId: webhooks.boardId, events: webhooks.events })
      .from(webhooks)
      .where(and(eq(webhooks.orgId, ctx.orgId), eq(webhooks.enabled, true), inArray(webhooks.boardId, boardIds)));
    if (rows.length === 0) return;
    const now = new Date().toISOString();
    const values = [];
    for (const event of events) {
      for (const name of webhookEventsFor(event)) {
        for (const row of rows) {
          if (row.boardId !== event.boardId || !row.events.includes(name)) continue;
          const metadata: OutboxMetadata = {
            deliveryId: randomUUID(),
            event: name,
            boardId: event.boardId,
            data: webhookEventData(event),
            attempts: 0,
            state: 'pending',
            nextAttemptAt: now,
          };
          values.push({
            orgId: ctx.orgId,
            actorId: ctx.userId,
            action: OUTBOX_ACTION,
            targetType: 'webhook',
            targetId: row.id,
            metadata: { ...metadata },
          });
        }
      }
    }
    if (values.length === 0) return;
    await ctx.db.insert(auditLog).values(values);
    kickWebhookWorker();
  } catch (error) {
    logger.error('webhooks.enqueue_failed', { orgId: ctx.orgId, error });
  }
}

// Worker --------------------------------------------------------------------------------------

let kickTimer: ReturnType<typeof setTimeout> | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let draining: Promise<number> | null = null;

/** Schedule a drain soon (after the enqueuing transaction has had time to commit). */
export function kickWebhookWorker(): void {
  if (!sweepTimer) {
    sweepTimer = setInterval(() => void drainWebhookOutbox(), SWEEP_MS);
    sweepTimer.unref?.();
  }
  if (kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    void drainWebhookOutbox();
  }, KICK_DELAY_MS);
  kickTimer.unref?.();
}

type OutboxRow = Pick<typeof auditLog.$inferSelect, 'id' | 'orgId' | 'actorId' | 'targetId' | 'metadata' | 'createdAt'>;

async function claim(executor: Executor, now: Date): Promise<OutboxRow[]> {
  const lockedUntil = new Date(now.getTime() + LOCK_MS).toISOString();
  const nowIso = now.toISOString();
  const result = await executor.execute(sql`
    update ${auditLog}
       set metadata = ${auditLog.metadata} || jsonb_build_object('state', 'sending', 'lockedUntil', ${lockedUntil}::text)
     where ${auditLog.id} in (
       select ${auditLog.id} from ${auditLog}
        where ${auditLog.action} = ${OUTBOX_ACTION}
          and (
            (${auditLog.metadata}->>'state' = 'pending' and (${auditLog.metadata}->>'nextAttemptAt')::timestamptz <= ${nowIso}::timestamptz)
            or (${auditLog.metadata}->>'state' = 'sending' and (${auditLog.metadata}->>'lockedUntil')::timestamptz < ${nowIso}::timestamptz)
          )
        order by ${auditLog.createdAt}
        limit ${BATCH}
        for update skip locked
     )
     returning id, org_id as "orgId", actor_id as "actorId", target_id as "targetId", metadata, created_at as "createdAt"`);
  return result.rows as unknown as OutboxRow[];
}

async function processRow(executor: Executor, entry: OutboxRow): Promise<void> {
  const meta = entry.metadata as unknown as OutboxMetadata;
  const remove = () => executor.delete(auditLog).where(eq(auditLog.id, entry.id));
  const [hook] = entry.targetId
    ? await executor.select().from(webhooks).where(eq(webhooks.id, entry.targetId)).limit(1)
    : [];
  if (!hook || !hook.enabled || hook.orgId !== entry.orgId) {
    await remove(); // Webhook deleted or turned off since the event: drop the delivery.
    return;
  }
  const attempt = (meta.attempts ?? 0) + 1;
  const payload: DeliveryPayload = { event: meta.event, boardId: meta.boardId, data: meta.data ?? {} };
  const outcome = await deliverWebhook(executor, hook as WebhookRow, entry.actorId ?? null, 'event', payload, {
    deliveryId: meta.deliveryId,
    attempt,
  });
  if (outcome.ok) {
    await remove();
    return;
  }
  const next = afterFailure(attempt, new Date());
  if (next.giveUp) await remove();
  else {
    await executor
      .update(auditLog)
      .set({
        metadata: {
          ...meta,
          attempts: attempt,
          state: 'pending',
          nextAttemptAt: next.nextAttemptAt.toISOString(),
          lockedUntil: undefined,
        },
      })
      .where(eq(auditLog.id, entry.id));
  }
  const [counter] = await executor
    .select({ failureCount: webhooks.failureCount })
    .from(webhooks)
    .where(eq(webhooks.id, hook.id))
    .limit(1);
  if (counter && counter.failureCount >= AUTO_DISABLE_AFTER) {
    await executor.update(webhooks).set({ enabled: false, updatedAt: new Date() }).where(eq(webhooks.id, hook.id));
    await executor.delete(auditLog).where(and(eq(auditLog.action, OUTBOX_ACTION), eq(auditLog.targetId, hook.id)));
    logger.warn('webhooks.auto_disabled', { webhookId: hook.id, failures: counter.failureCount });
  }
}

/** Deliver due outbox rows; returns how many were processed. Safe to call concurrently. */
export async function drainWebhookOutbox(executor: Executor = defaultDb): Promise<number> {
  if (draining) return draining;
  draining = (async () => {
    let processed = 0;
    try {
      for (;;) {
        const rows = await claim(executor, new Date());
        if (rows.length === 0) break;
        await mapLimit(rows, DELIVERY_CONCURRENCY, async (row) => {
          try {
            await processRow(executor, row);
          } catch (error) {
            logger.error('webhooks.outbox_row_failed', { id: row.id, error });
          }
        });
        processed += rows.length;
        if (rows.length < BATCH) break;
      }
    } catch (error) {
      logger.error('webhooks.drain_failed', { error });
    } finally {
      draining = null;
    }
    return processed;
  })();
  return draining;
}
