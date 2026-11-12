/**
 * Scheduled "date arrives" scan. Called by `POST /api/v1/automations/scan` (cron / admin).
 * Idempotent per (automation, item, day): an item fires at most once per calendar day.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { automationRuns, automations, items } from '@/server/db/schema';
import type { ServiceContext } from '@/server/services/context';
import { parseAutomation, runAutomation, type RunResult } from './engine';

const MAX_ITEMS_PER_AUTOMATION = 500;

function shiftDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface ScanSummary {
  readonly date: string;
  readonly automationsScanned: number;
  readonly runs: readonly RunResult[];
}

export async function runDateArrivedScan(
  ctx: ServiceContext,
  today = new Date().toISOString().slice(0, 10),
): Promise<ScanSummary> {
  const rows = await ctx.db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.orgId, ctx.orgId),
        eq(automations.enabled, true),
        isNull(automations.deletedAt),
        sql`${automations.trigger} ->> 'type' = 'date_arrived'`,
      ),
    );
  const runs: RunResult[] = [];
  let scanned = 0;
  for (const row of rows) {
    const automation = parseAutomation(row);
    if (!automation || automation.trigger.type !== 'date_arrived') continue;
    scanned += 1;
    const { columnKey, offsetDays } = automation.trigger.config;
    // Fires when `date + offsetDays == today` (e.g. offset -1 = "one day before").
    const targetDate = shiftDate(today, -offsetDays);
    const dueItems = await ctx.db
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.boardId, row.boardId),
          eq(items.orgId, ctx.orgId),
          isNull(items.deletedAt),
          isNull(items.archivedAt),
          sql`${items.values} -> ${columnKey}::text ->> 'date' = ${targetDate}`,
          sql`not exists (select 1 from ${automationRuns} r where r.automation_id = ${row.id} and r.item_id = ${items.id} and r.trigger_event ->> 'scanDate' = ${today})`,
        ),
      )
      .limit(MAX_ITEMS_PER_AUTOMATION);
    for (const item of dueItems) {
      const result = await runAutomation(ctx, automation, item.id, {
        type: 'date_arrived',
        boardId: row.boardId,
        itemId: item.id,
        columnKey,
        scanDate: today,
      });
      if (result) runs.push(result);
    }
  }
  return { date: today, automationsScanned: scanned, runs };
}
