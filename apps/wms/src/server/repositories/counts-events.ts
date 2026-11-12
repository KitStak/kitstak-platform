/**
 * Count plan timeline events (M07). Status changes and field diffs already reach the change log;
 * these rows add the operational facts an auditor needs without opening the ledger or the job:
 * job creation / reissue (job code, tasks, locations, batch size, assignee), count entry
 * submission (location, counted vs system, who), recount creation (new job), and the Update Inv.
 * adjustment reason and note.
 *
 * Rows are written to `change_log` as `Update` entries with `field = "count_event"` and no field
 * label, so the shared change-log drawer prints the message as is, and the plan timeline renders
 * `toValue` (see `countChangeParts`). Line events carry the plan as parent, like line diffs.
 */
import { eq, inArray } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import type { DomainCtx, Tx } from '@/server/domain/types';

export const COUNT_EVENT_FIELD = 'count_event';

interface EventRef {
  readonly planId: string;
  readonly planCode: string;
  /** Line events: the count line and its label ("MLT1-A-01 · SKU-1"). */
  readonly line?: { readonly id: string; readonly label: string } | null;
  readonly text: string;
}

export async function recordCountEvent(tx: Tx, ctx: DomainCtx, ref: EventRef): Promise<void> {
  const text = ref.text.slice(0, 1000);
  await tx.insert(schema.changeLog).values(
    ref.line
      ? {
          entityType: 'count_line',
          entityId: ref.line.id,
          entityCode: ref.planCode,
          parentEntityType: 'count_plan',
          parentEntityId: ref.planId,
          type: 'Update',
          field: COUNT_EVENT_FIELD,
          fieldLabel: null,
          fromValue: null,
          toValue: text,
          message: `${ref.line.label} -> ${text}`,
          userId: ctx.userId,
          source: ctx.source,
        }
      : {
          entityType: 'count_plan',
          entityId: ref.planId,
          entityCode: ref.planCode,
          type: 'Update',
          field: COUNT_EVENT_FIELD,
          fieldLabel: null,
          fromValue: null,
          toValue: text,
          message: text,
          userId: ctx.userId,
          source: ctx.source,
        },
  );
}

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const signed = (n: number): string =>
  n > 0 ? `+${n.toLocaleString('en-US')}` : n < 0 ? `−${Math.abs(n).toLocaleString('en-US')}` : '0';

export async function userName(tx: Tx, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const u = (
    await tx
      .select({ name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)
  )[0];
  return u ? u.name || u.email : null;
}

export type JobEventKind = 'created' | 'reissued' | 'recount';

/** "Count job JOB005330 created · 12 tasks across 12 locations · batch size 25 · assigned to Jane Doe". */
export function jobEventText(input: {
  readonly kind: JobEventKind;
  readonly jobCode: string;
  readonly tasks: number;
  readonly locations: number;
  readonly batchSize?: number | null;
  readonly assignee: string | null;
  readonly recountOf?: readonly string[];
}): string {
  const head =
    input.kind === 'recount'
      ? `Recount job ${input.jobCode} created`
      : input.kind === 'reissued'
        ? `Count job ${input.jobCode} re-created for lines whose job was cancelled`
        : `Count job ${input.jobCode} created`;
  const parts = [
    head,
    `${plural(input.tasks, 'task', 'tasks')} across ${plural(input.locations, 'location', 'locations')}`,
    input.batchSize ? `batch size ${input.batchSize}` : null,
    input.assignee ? `assigned to ${input.assignee}` : 'job pool (unassigned)',
    input.recountOf?.length
      ? `recounts ${input.recountOf.slice(0, 5).join(', ')}${input.recountOf.length > 5 ? ` +${input.recountOf.length - 5}` : ''}`
      : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

export async function recordJobEvent(
  tx: Tx,
  ctx: DomainCtx,
  plan: { readonly id: string; readonly code: string },
  jobId: string,
  kind: JobEventKind,
  opts: { readonly batchSize?: number | null; readonly recountOf?: readonly string[] } = {},
): Promise<void> {
  const job = (
    await tx
      .select({ code: schema.jobs.code, assignee: schema.jobs.assignedToUserId })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, jobId))
      .limit(1)
  )[0];
  if (!job) return;
  const taskRows = await tx
    .select({ loc: schema.tasks.sourceLocationId })
    .from(schema.tasks)
    .where(eq(schema.tasks.jobId, jobId));
  await recordCountEvent(tx, ctx, {
    planId: plan.id,
    planCode: plan.code,
    text: jobEventText({
      kind,
      jobCode: job.code,
      tasks: taskRows.length,
      locations: new Set(taskRows.map((t) => t.loc).filter(Boolean)).size,
      batchSize: opts.batchSize ?? null,
      assignee: await userName(tx, job.assignee),
      recountOf: opts.recountOf,
    }),
  });
}

/** "Counted 24 vs system 26 (−2) · 3 buckets · 1 found · 1 damaged · note: …". Blind jobs omit nothing: the audit sees both. */
export function entryEventText(input: {
  readonly counted: number;
  readonly system: number;
  readonly buckets: number;
  readonly found: number;
  readonly damaged: number;
  readonly location: string | null;
  readonly note?: string | null;
}): string {
  return [
    `Counted ${input.counted.toLocaleString('en-US')} vs system ${input.system.toLocaleString('en-US')} (${signed(input.counted - input.system)})`,
    input.location ? `at ${input.location}` : null,
    plural(input.buckets, 'bucket', 'buckets'),
    input.found ? `${input.found} found` : null,
    input.damaged ? `${input.damaged} damaged` : null,
    input.note?.trim() ? `note: ${input.note.trim()}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Count entry submission for one line, read back from the stored entries (whatever path recorded them). */
export async function recordEntryEvent(
  tx: Tx,
  ctx: DomainCtx,
  plan: { readonly id: string; readonly code: string },
  line: { readonly id: string; readonly label: string },
  note?: string | null,
): Promise<void> {
  const entries = await tx
    .select({
      countedQty: schema.countLineEntries.countedQty,
      systemQty: schema.countLineEntries.systemQty,
      damageReason: schema.countLineEntries.damageReason,
      locationId: schema.countLineEntries.locationId,
    })
    .from(schema.countLineEntries)
    .where(eq(schema.countLineEntries.lineId, line.id));
  const locIds = [...new Set(entries.map((e) => e.locationId).filter((x): x is string => Boolean(x)))];
  const codes = locIds.length
    ? (
        await tx
          .select({ code: schema.locations.code })
          .from(schema.locations)
          .where(inArray(schema.locations.id, locIds))
      ).map((l) => l.code)
    : [];
  await recordCountEvent(tx, ctx, {
    planId: plan.id,
    planCode: plan.code,
    line,
    text: entryEventText({
      counted: entries.reduce((s, e) => s + e.countedQty, 0),
      system: entries.reduce((s, e) => s + e.systemQty, 0),
      buckets: entries.length,
      found: entries.filter((e) => e.systemQty === 0 && e.countedQty > 0 && !e.damageReason).length,
      damaged: entries.filter((e) => Boolean(e.damageReason)).length,
      location: codes.length === 1 ? (codes[0] ?? null) : null,
      note,
    }),
  });
}

/** "Inventory updated for 3 lines · 5 ledger postings · reason Cycle count · note: …". */
export function updateInvEventText(input: {
  readonly lines: number;
  readonly postings: number;
  readonly reason: string | null;
  readonly note?: string | null;
  readonly cancelledOpen?: number;
}): string {
  return [
    `Inventory updated for ${plural(input.lines, 'counted line', 'counted lines')}`,
    input.postings ? plural(input.postings, 'ledger posting', 'ledger postings') : 'no stock change',
    input.reason ? `reason ${input.reason}` : 'no adjustment reason',
    input.note?.trim() ? `note: ${input.note.trim()}` : null,
    input.cancelledOpen ? `${plural(input.cancelledOpen, 'open line', 'open lines')} cancelled` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export async function reasonName(tx: Tx, reasonId: string | null | undefined): Promise<string | null> {
  if (!reasonId) return null;
  return (
    (
      await tx
        .select({ name: schema.lookupValues.name })
        .from(schema.lookupValues)
        .where(eq(schema.lookupValues.id, reasonId))
        .limit(1)
    )[0]?.name ?? null
  );
}
