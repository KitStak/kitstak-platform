/**
 * Timestamp rewriting for seeded rows. The domain layer stamps everything "now"; a demo needs a
 * believable past (tasks opened weeks ago, finished on or near their due dates, comments spread
 * between, inbox items from the last few days, reports with real burn-up curves).
 *
 * `pm.activity` is append-only (an UPDATE trigger rejects changes), so activity rows are
 * re-timestamped by deleting and re-inserting them with the same id and new `created_at`, inside
 * one transaction. Nothing else references activity rows, so this is safe.
 */
import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';

type Executor = Pick<typeof db, 'execute'>;

const ACTIVITY_COLUMNS = sql.raw(
  'id, org_id, project_id, task_id, actor_id, actor_kind, verb, entity_type, entity_id, field, before, after, meta',
);

/** Database clock (used as a "since" marker for rows written after this point). */
export async function dbClock(): Promise<string> {
  const result = await db.execute<{ ts: string }>(sql`select clock_timestamp()::text as ts`);
  return result.rows[0].ts;
}

const iso = (date: Date) => date.toISOString();

/** Deterministic 0..1 from a string (stable seeds across runs). */
export function hash01(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100_000) / 100_000;
}

/** Both seeded orgs work US Central hours; the demo history should read like a normal workday. */
const BUSINESS_TIME_ZONE = 'America/Chicago';

/** Minutes the business time zone is ahead of UTC at `date` (negative for the Americas). */
function zoneOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000);
}

/**
 * A moment `daysAgo` calendar days back (by the app's UTC "today") at `hour` o'clock business
 * time (fractional hours allowed). Never later than a few minutes ago.
 */
export function momentAt(daysAgo: number, hour: number, now: Date = new Date()): Date {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
  const naive = day.getTime() + Math.round(hour * 60) * 60_000;
  const date = new Date(naive - zoneOffsetMinutes(new Date(naive)) * 60_000);
  const ceiling = new Date(now.getTime() - 5 * 60_000);
  if (date <= ceiling) return date;
  // Seeding before the workday starts: "today's" work happened late yesterday instead.
  if (businessHour(now) < 8 && daysAgo <= 0) return momentAt(1, Math.min(Math.max(hour, 14), 17.5), now);
  return ceiling;
}

/** Hour of day (fractional) in the business time zone. */
export function businessHour(date: Date): number {
  const local = new Date(date.getTime() + zoneOffsetMinutes(date) * 60_000);
  return local.getUTCHours() + local.getUTCMinutes() / 60;
}

/** Pulls a moment into working hours (8:00–18:00 business time) on the same day. */
function intoWorkHours(ms: number): number {
  const hour = businessHour(new Date(ms));
  if (hour >= 8 && hour < 18) return ms;
  const target = hour < 8 ? 8 + hour * 0.5 : 13 + (hour - 18) * 0.6;
  return ms + Math.round((target - hour) * 3_600_000);
}

/** Re-stamps activity rows matched by `where` to `ts` (keeping their order with 1-second steps). */
async function restampActivity(tx: Executor, where: SQL, ts: Date): Promise<void> {
  await tx.execute(sql`
    with moved as (delete from pm.activity a where ${where} returning a.*),
    ordered as (select moved.*, row_number() over (order by created_at, id) as rn from moved)
    insert into pm.activity (${ACTIVITY_COLUMNS}, created_at)
    select ${ACTIVITY_COLUMNS}, ${iso(ts)}::timestamptz + (rn - 1) * interval '1 second' from ordered`);
}

/** Project-level rows (no task) written since `marker` → `ts`: setup, links, files, status updates. */
export async function stampProjectSince(projectId: string, marker: string, ts: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await restampActivity(tx, sql`a.project_id = ${projectId} and a.task_id is null and a.created_at >= ${marker}::timestamptz`, ts);
    await tx.execute(sql`update pm.notifications set created_at = ${iso(ts)}::timestamptz
      where project_id = ${projectId} and task_id is null and created_at >= ${marker}::timestamptz`);
    await tx.execute(sql`update pm.attachments set created_at = ${iso(ts)}::timestamptz
      where project_id = ${projectId} and task_id is null and created_at >= ${marker}::timestamptz`);
    await tx.execute(sql`update pm.integration_links set created_at = ${iso(ts)}::timestamptz
      where project_id = ${projectId} and created_at >= ${marker}::timestamptz`);
  });
}

/** Org-level rows (no project, no task) written since `marker` → `ts`: spaces, goals, check-ins. */
export async function stampOrgSince(orgId: string, marker: string, ts: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await restampActivity(tx, sql`a.org_id = ${orgId} and a.project_id is null and a.task_id is null and a.created_at >= ${marker}::timestamptz`, ts);
    await tx.execute(sql`update pm.notifications set created_at = ${iso(ts)}::timestamptz
      where org_id = ${orgId} and project_id is null and task_id is null and created_at >= ${marker}::timestamptz`);
  });
}

/** Every org row (any project, no task) written since `marker` → `ts`: goal links, check-ins. */
export async function stampOrgAllSince(orgId: string, marker: string, ts: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await restampActivity(tx, sql`a.org_id = ${orgId} and a.task_id is null and a.created_at >= ${marker}::timestamptz`, ts);
    await tx.execute(sql`update pm.notifications set created_at = ${iso(ts)}::timestamptz
      where org_id = ${orgId} and task_id is null and created_at >= ${marker}::timestamptz`);
  });
}

export interface TaskTimeline {
  readonly createdAt: Date;
  /** When the task was finished (done/cancelled), else null. */
  readonly completedAt: Date | null;
  /** Latest moment of activity for open tasks. */
  readonly lastTouchedAt: Date;
}

/**
 * Spreads a task's history between `createdAt` and its end. Every distinct write moment of the
 * task (each domain transaction) becomes one step; steps are mapped in order onto the new
 * timeline and every row written at that moment (activity, comments, notifications, automation
 * runs) moves with its step. Time-entry activity follows the entry's own date.
 */
export async function backdateTask(taskId: string, timeline: TaskTimeline): Promise<void> {
  const stepRows = await db.execute<{ ts: string }>(sql`
    select ts::text as ts from (select distinct created_at as ts from pm.activity where task_id = ${taskId} and verb <> 'time.logged') s order by s.ts`);
  const steps = stepRows.rows.map((row) => row.ts);
  if (steps.length === 0) return;
  const start = timeline.createdAt.getTime();
  const end = Math.max(start, (timeline.completedAt ?? timeline.lastTouchedAt).getTime());
  const targets: number[] = [];
  steps.forEach((_, index) => {
    if (index === 0) targets.push(start);
    else if (index === steps.length - 1) targets.push(end);
    else {
      const share = index / (steps.length - 1);
      const jitter = (hash01(`${taskId}:${index}`) - 0.5) * (0.5 / steps.length);
      const raw = start + (end - start) * Math.min(0.98, Math.max(0.02, share + jitter));
      targets.push(Math.min(end, Math.max(start, intoWorkHours(raw))));
    }
  });
  for (let i = 1; i < targets.length; i += 1) targets[i] = Math.max(targets[i], targets[i - 1] + 60_000);
  const ceiling = Date.now() - 2 * 60_000;
  const mapping = JSON.stringify(steps.map((orig, index) => ({ o: orig, n: new Date(Math.min(targets[index], ceiling)).toISOString() })));
  const first = new Date(Math.min(targets[0], ceiling)).toISOString();
  const m = sql`(select * from jsonb_to_recordset(${mapping}::jsonb) as u(o timestamptz, n timestamptz))`;
  const mapTs = (column: SQL) => sql`coalesce((select mm.n from ${m} mm where mm.o <= ${column} order by mm.o desc limit 1), ${first}::timestamptz)`;

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      with moved as (delete from pm.activity a where a.task_id = ${taskId} returning a.*)
      insert into pm.activity (${ACTIVITY_COLUMNS}, created_at)
      select ${ACTIVITY_COLUMNS},
        case when moved.verb = 'time.logged'
          then coalesce((select te.ended_at from pm.time_entries te where te.id = moved.entity_id), ${mapTs(sql`moved.created_at`)})
          else ${mapTs(sql`moved.created_at`)} end
      from moved`);
    await tx.execute(sql`update pm.comments c set created_at = ${mapTs(sql`c.created_at`)}, updated_at = ${mapTs(sql`c.updated_at`)}
      where c.task_id = ${taskId}`);
    await tx.execute(sql`update pm.notifications nt set created_at = ${mapTs(sql`nt.created_at`)} where nt.task_id = ${taskId}`);
    await tx.execute(sql`update pm.automation_runs r set created_at = ${mapTs(sql`r.created_at`)} where r.task_id = ${taskId}`);
    await tx.execute(sql`update pm.integration_links l set created_at = ${mapTs(sql`l.created_at`)}, cached_at = now() where l.task_id = ${taskId}`);
    await tx.execute(sql`update pm.attachments f set created_at = ${mapTs(sql`f.created_at`)} where f.task_id = ${taskId}`);
    await tx.execute(sql`update pm.watchers w set created_at = ${first}::timestamptz where w.task_id = ${taskId}`);
    await tx.execute(sql`update pm.task_labels tl set created_at = ${first}::timestamptz where tl.task_id = ${taskId}`);
    await tx.execute(sql`update pm.task_dependencies d set created_at = ${mapTs(sql`d.created_at`)} where d.blocked_task_id = ${taskId}`);
    await tx.execute(sql`
      update pm.tasks t set
        created_at = ${first}::timestamptz,
        completed_at = case when t.completed_at is null then null else coalesce(
          (select max(a.created_at) from pm.activity a where a.task_id = t.id and a.field = 'status'), ${mapTs(sql`t.completed_at`)}) end,
        updated_at = (select max(a.created_at) from pm.activity a where a.task_id = t.id)
      where t.id = ${taskId}`);
  });
}

/** Moves a time entry (and nothing else; its activity follows in `backdateTask`). */
export async function backdateTimeEntry(entryId: string, start: Date, minutes: number): Promise<void> {
  const latestEnd = Date.now() - 3 * 60_000;
  const startedAt = start.getTime() + minutes * 60_000 > latestEnd ? new Date(latestEnd - minutes * 60_000) : start;
  const ended = new Date(startedAt.getTime() + minutes * 60_000);
  await db.execute(sql`update pm.time_entries set started_at = ${iso(startedAt)}::timestamptz, ended_at = ${iso(ended)}::timestamptz,
    created_at = ${iso(ended)}::timestamptz, updated_at = ${iso(ended)}::timestamptz where id = ${entryId}`);
}

export async function setRowTimes(table: 'projects' | 'spaces' | 'goals' | 'automations' | 'forms' | 'templates' | 'saved_views' | 'milestones' | 'labels' | 'sections' | 'custom_fields' | 'statuses', id: string, createdAt: Date, updatedAt: Date = createdAt): Promise<void> {
  const hasUpdated = table !== 'labels';
  await db.execute(
    hasUpdated
      ? sql`update ${sql.raw(`pm.${table}`)} set created_at = ${iso(createdAt)}::timestamptz, updated_at = ${iso(updatedAt)}::timestamptz where id = ${id}`
      : sql`update ${sql.raw(`pm.${table}`)} set created_at = ${iso(createdAt)}::timestamptz where id = ${id}`,
  );
}
