/**
 * Labor history backfill (M13, dev / demo data only). The demo seed records every completed
 * task with start == finish and puts nearly all work on three associates, so the labor
 * dashboards had little to show and every duration was inferred from gaps. This backfill:
 *
 * 1. adds a realistic floor team (six more warehouse associates),
 * 2. spreads the seed's untimed jobs across each warehouse's team, a whole job at a time
 *    (tasks, and the ledger rows those tasks wrote, move together), and
 * 3. records a real start scan on every untimed completed task: a per-type duration scaled by
 *    the associate's pace, never overlapping the associate's previous task. Tasks finished in
 *    the same instant (a batch scan) are laid out back to back before that instant.
 *
 * It only touches tasks without a start scan (`started_at IS NULL OR started_at >= finished_at`),
 * so live work is never rewritten and a second run changes nothing.
 */
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { hashPassword } from "@/server/auth/password";
import * as schema from "@/server/db/schema";

export interface LaborAssociateSpec {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly warehouse: "MLT1" | "KS2";
  /** Pace multiplier on task durations (below 1 = faster than the median associate). */
  readonly pace: number;
}

/** Seeded associates whose untimed jobs are shared out, with their own pace. */
export const SEED_ASSOCIATE_PACE: Readonly<Record<string, number>> = {
  "t.nguyen@kitstak.io": 0.78,
  "j.okafor@kitstak.io": 1.0,
  "d.castillo@kitstak.io": 1.12,
};

export const EXTRA_ASSOCIATES: readonly LaborAssociateSpec[] = [
  { email: "p.patel@kitstak.io", firstName: "Priya", lastName: "Patel", warehouse: "MLT1", pace: 0.88 },
  { email: "m.rossi@kitstak.io", firstName: "Marco", lastName: "Rossi", warehouse: "MLT1", pace: 1.18 },
  { email: "a.bello@kitstak.io", firstName: "Aisha", lastName: "Bello", warehouse: "MLT1", pace: 0.97 },
  { email: "s.whitaker@kitstak.io", firstName: "Sam", lastName: "Whitaker", warehouse: "MLT1", pace: 1.36 },
  { email: "l.kowalski@kitstak.io", firstName: "Lena", lastName: "Kowalski", warehouse: "KS2", pace: 0.92 },
  { email: "t.herrera@kitstak.io", firstName: "Tomas", lastName: "Herrera", warehouse: "KS2", pace: 1.24 },
];

/** Median seconds per task type for an associate at pace 1. */
export const TYPE_SECONDS: Readonly<Record<string, number>> = {
  Picking: 95, Packing: 70, Loading: 150, Sorting: 60, Kitting: 420, Count: 240, Replenishment: 300,
};

/** Only these seeded associates give up jobs (Jonah keeps his: he is the operator login). */
const DONORS: readonly string[] = ["t.nguyen@kitstak.io", "d.castillo@kitstak.io"];

/** Deterministic 0..1 from a string (FNV-1a). */
export function unitHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) / 0xffffffff;
}

/** Seconds a task takes: the type median × pace × a 0.6–1.4 spread, at least 20 s. */
export function taskSeconds(type: string, pace: number, key: string): number {
  const base = TYPE_SECONDS[type] ?? 90;
  return Math.max(20, Math.round(base * pace * (0.6 + 0.8 * unitHash(key))));
}

export interface TimedTask { readonly id: string; readonly finishedMs: number; readonly seconds: number }
export interface StartPlan { readonly id: string; readonly startMs: number; readonly finishMs: number }

/**
 * Lays one associate's day out: each task starts `seconds` before it finishes, but never
 * before the previous task's finish (+5 s). Tasks finishing within 2 s of the previous one (a
 * batch scan) are moved back so they run one after another and end at the batch instant.
 * Returns only the tasks that get a real start (the rest stay inferred).
 */
export function planStarts(tasks: readonly TimedTask[], dayStartMs: number | null = null): StartPlan[] {
  const sorted = [...tasks].sort((a, b) => a.finishedMs - b.finishedMs || a.id.localeCompare(b.id));
  // Group batch scans: consecutive tasks finishing within 2 s of each other.
  const groups: TimedTask[][] = [];
  for (const t of sorted) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev && t.finishedMs - prev.finishedMs < 2_000) last.push(t);
    else groups.push([t]);
  }
  const out: StartPlan[] = [];
  let cursor = dayStartMs;
  for (const g of groups) {
    const end = g[g.length - 1]!.finishedMs;
    const room = cursor === null ? Number.POSITIVE_INFINITY : end - cursor - 5_000;
    const want = g.reduce((s, t) => s + t.seconds * 1000, 0);
    const scale = want > room ? room / want : 1;
    if (scale * Math.min(...g.map((t) => t.seconds)) * 1000 < 15_000) { cursor = end; continue; }
    let t0 = end - want * scale;
    for (const t of g) {
      const d = t.seconds * 1000 * scale;
      out.push({ id: t.id, startMs: Math.round(t0), finishMs: Math.round(t0 + d) });
      t0 += d;
    }
    cursor = end;
  }
  return out;
}

export interface LaborBackfillReport {
  readonly usersCreated: number;
  readonly tasksReassigned: number;
  readonly ledgerRowsReassigned: number;
  readonly tasksTimed: number;
  readonly tasksLeftInferred: number;
}

const UNTIMED = sql`(t.started_at IS NULL OR t.started_at >= t.finished_at)`;

export function backfillLaborHistory(db: AppDb, opts: { readonly passwordSeed?: string } = {}): LaborBackfillReport {
  const whByCode = new Map(db.all<{ id: string; code: string }>(sql`SELECT id, code FROM warehouses`).map((w) => [w.code, w.id]));
  const clerkRole = db.all<{ id: string }>(sql`SELECT id FROM roles WHERE name = 'Warehouse Clerk' LIMIT 1`)[0]?.id;

  // 1. The floor team.
  let usersCreated = 0;
  const pace = new Map<string, number>();
  const pool = new Map<string, string[]>(); // warehouse id → associate user ids
  for (const [email, p] of Object.entries(SEED_ASSOCIATE_PACE)) {
    const u = db.all<{ id: string }>(sql`SELECT id FROM users WHERE email = ${email}`)[0];
    if (u) pace.set(u.id, p);
  }
  for (const a of EXTRA_ASSOCIATES) {
    const whId = whByCode.get(a.warehouse);
    if (!whId) continue;
    let id = db.all<{ id: string }>(sql`SELECT id FROM users WHERE email = ${a.email}`)[0]?.id;
    if (!id) {
      // Login is not the point of these users: a random password nobody knows.
      const secret = `${opts.passwordSeed ?? "labor"}-${a.email}-${Math.random().toString(36).slice(2)}${Date.now()}`;
      id = db.insert(schema.users).values({
        email: a.email, name: `${a.firstName} ${a.lastName}`, firstName: a.firstName, lastName: a.lastName,
        passwordHash: hashPassword(secret, 4), role: "operator", userType: "Operation", allClients: true,
        preferences: { dateFormat: "M/D/YYYY h:mm:ss A", timeFormat: "12h", numberFormat: "1,025.00", density: "Large", defaultWarehouseId: whId },
      }).returning({ id: schema.users.id }).get().id;
      if (clerkRole) db.insert(schema.userRoles).values({ userId: id, roleId: clerkRole }).run();
      db.insert(schema.userWarehouses).values({ userId: id, warehouseId: whId }).run();
      usersCreated += 1;
    } else if (!db.select().from(schema.userWarehouses).where(and(eq(schema.userWarehouses.userId, id), eq(schema.userWarehouses.warehouseId, whId))).get()) {
      db.insert(schema.userWarehouses).values({ userId: id, warehouseId: whId }).run();
    }
    pace.set(id, a.pace);
    pool.set(whId, [...(pool.get(whId) ?? []), id]);
  }

  // 2. Share the donors' untimed jobs across their warehouse's team, one whole job at a time.
  let tasksReassigned = 0;
  let ledgerRowsReassigned = 0;
  for (const email of DONORS) {
    const donor = db.all<{ id: string }>(sql`SELECT id FROM users WHERE email = ${email}`)[0]?.id;
    if (!donor) continue;
    const jobs = db.all<{ job: string; wh: string }>(sql`
      SELECT t.job_id AS job, MIN(t.warehouse_id) AS wh FROM tasks t
      WHERE t.executed_by_user_id = ${donor} AND t.status = 'Completed' AND t.job_id IS NOT NULL AND ${UNTIMED}
      GROUP BY t.job_id`);
    for (const j of jobs) {
      const team = [donor, ...(pool.get(j.wh) ?? [])];
      const to = team[Math.floor(unitHash(`job:${j.job}`) * team.length) % team.length]!;
      if (to === donor) continue;
      const ids = db.all<{ id: string }>(sql`SELECT t.id FROM tasks t WHERE t.job_id = ${j.job} AND t.executed_by_user_id = ${donor} AND t.status = 'Completed' AND ${UNTIMED}`).map((r) => r.id);
      for (const tid of ids) {
        db.run(sql`UPDATE tasks SET executed_by_user_id = ${to}, assignee_user_id = CASE WHEN assignee_user_id = ${donor} THEN ${to} ELSE assignee_user_id END WHERE id = ${tid}`);
        const res = db.run(sql`UPDATE inventory_transactions SET user_id = ${to} WHERE task_id = ${tid} AND user_id = ${donor}`) as unknown as { changes?: number };
        ledgerRowsReassigned += Number(res?.changes ?? 0);
      }
      tasksReassigned += ids.length;
    }
  }

  // 3. Real start scans on every untimed completed task.
  const rows = db.all<{ id: string; uid: string; type: string; fin: string }>(sql`
    SELECT t.id AS id, t.executed_by_user_id AS uid, t.task_type AS type, t.finished_at AS fin
    FROM tasks t WHERE t.status = 'Completed' AND t.executed_by_user_id IS NOT NULL AND t.finished_at IS NOT NULL
    ORDER BY t.executed_by_user_id, t.finished_at`);
  const untimed = new Set(db.all<{ id: string }>(sql`SELECT t.id AS id FROM tasks t WHERE t.status = 'Completed' AND t.finished_at IS NOT NULL AND ${UNTIMED}`).map((r) => r.id));
  const byUserDay = new Map<string, { timedBefore: number | null; tasks: TimedTask[]; fixedEnds: number[] }>();
  for (const r of rows) {
    const key = `${r.uid}|${r.fin.slice(0, 10)}`;
    const e = byUserDay.get(key) ?? { timedBefore: null, tasks: [], fixedEnds: [] };
    const fin = Date.parse(r.fin);
    if (untimed.has(r.id)) e.tasks.push({ id: r.id, finishedMs: fin, seconds: taskSeconds(r.type, pace.get(r.uid) ?? 1, r.id) });
    else e.fixedEnds.push(fin);
    byUserDay.set(key, e);
  }
  let tasksTimed = 0;
  let tasksLeftInferred = 0;
  for (const e of byUserDay.values()) {
    if (e.tasks.length === 0) continue;
    // Already-timed tasks the same day bound the layout: plan each stretch between them.
    const ends = [...e.fixedEnds].sort((a, b) => a - b);
    const stretches = new Map<number, TimedTask[]>();
    for (const t of e.tasks) {
      const before = ends.filter((x) => x < t.finishedMs).pop() ?? -1;
      stretches.set(before, [...(stretches.get(before) ?? []), t]);
    }
    for (const [before, list] of stretches) {
      const plan = planStarts(list, before >= 0 ? before : null);
      for (const p of plan) {
        db.run(sql`UPDATE tasks SET started_at = ${new Date(p.startMs).toISOString()}, finished_at = ${new Date(p.finishMs).toISOString()} WHERE id = ${p.id}`);
      }
      tasksTimed += plan.length;
      tasksLeftInferred += list.length - plan.length;
    }
  }
  return { usersCreated, tasksReassigned, ledgerRowsReassigned, tasksTimed, tasksLeftInferred };
}
