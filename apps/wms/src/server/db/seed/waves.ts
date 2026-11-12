/**
 * Outbound replay, part 2: wave runs. Each scheduled (or manual) wave selects eligible
 * Open / Shortage orders, logs a `waves` row, allocates through `allocation.allocateOrders`
 * (shortages + allocation exceptions are written by the engine), creates picking jobs per
 * job type with `jobs.createJobsFromOrders`, assigns pickers and schedules the pick work.
 */
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { allocation, jobs } from "@/server/domain";
import type { DomainCtx, Tx } from "@/server/domain/types";
import type { WarehouseCode } from "../seed-orders";
import { jobTypeKey, type JobTypeCode, type WaveRuleRef } from "./config";
import { REPLAY_DAYS, checkBulk } from "./outbound";
import { MINUTE_MS, isoOf, utcAt, weekdayOf } from "./runtime";
import { actor, integrationCtx, txAt, type Id } from "./types";
import { schedulePickJob } from "./work";
import { noteFailure, operatorFor, type World } from "./world";
import { dbGet, forEachSeq, mapSeq } from "@/server/db/sql";

type RuleKey = "d2c" | "b2b" | "rush" | "ks2";

interface WaveSlot {
  readonly rule: RuleKey;
  readonly hour: number;
  readonly minute: number;
  readonly days: readonly number[];
  readonly manual: boolean;
  /** Only on the anchor day: an ad-hoc wave so "now" shows work in progress. */
  readonly adHocToday?: boolean;
}

const WEEKDAYS = [1, 2, 3, 4, 5] as const;
const SLOTS: readonly WaveSlot[] = [
  { rule: "d2c", hour: 13, minute: 30, days: WEEKDAYS, manual: false },
  { rule: "b2b", hour: 15, minute: 0, days: [1, 3, 5], manual: false },
  { rule: "ks2", hour: 15, minute: 30, days: [1, 2, 4], manual: true },
  { rule: "rush", hour: 16, minute: 30, days: [2, 4], manual: true },
  { rule: "d2c", hour: 18, minute: 30, days: WEEKDAYS, manual: false },
  { rule: "d2c", hour: 15, minute: 20, days: [], manual: true, adHocToday: true },
];

const warehouseOf = (rule: RuleKey): WarehouseCode => (rule === "ks2" ? "KS2" : "MLT1");

async function candidates(tx: Tx, warehouseId: Id, rule: RuleKey, atMs: number): Promise<{ id: Id; channel: string; units: number }[]> {
  const o = schema.shipmentOrders;
  const rows = await tx.select({ id: o.id, channel: o.channel, priority: o.priority }).from(o).where(and(
    eq(o.warehouseId, warehouseId), inArray(o.status, ["Open", "Shortage"]), eq(o.workflowBlocked, "None"), isNull(o.deletedAt),
    lte(o.orderDate, isoOf(atMs)),
  )).orderBy(sql`CASE ${o.priority} WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 ELSE 2 END`, o.orderDate);
  const filtered = rows.filter((r) => (rule === "b2b" ? r.channel === "Wholesale" : r.channel !== "Wholesale")
    && (rule !== "rush" || r.priority === "High" || r.priority === "Urgent"));
  return await mapSeq(filtered, async (r) => ({
    ...r,
    units: (await dbGet<{ n: number }>(tx, sql`SELECT COALESCE(SUM(quantity - cancelled_quantity), 0) AS n FROM order_lines WHERE order_id = ${r.id}`))?.n ?? 0,
  }));
}

function jobTypeFor(c: { channel: string; units: number }): JobTypeCode {
  if (c.channel === "Wholesale") return "B2B Order Picking";
  return c.units === 1 ? "Single Unit Orders" : "Multi Item Orders";
}

interface WaveOutcome {
  readonly jobIds: readonly Id[];
}

async function runWave(w: World, tx: Tx, ctx: DomainCtx, rule: WaveRuleRef, ruleKey: RuleKey, atMs: number, runBy: string): Promise<WaveOutcome> {
  const ruleRow = (await tx.select().from(schema.waveRules).where(eq(schema.waveRules.id, rule.id)).limit(1))[0];
  if (!ruleRow) throw new Error(`Wave rule ${rule.name} is missing`);
  const runCount = ruleRow.runCount + 1;
  const waveNo = `${rule.ruleSeq}-${runCount}`;
  const list = await candidates(tx, rule.warehouseId, ruleKey, atMs);
  const wave = (await tx.insert(schema.waves).values({ waveNo, waveRuleId: rule.id, warehouseId: rule.warehouseId, status: "Started", runBy, runAt: isoOf(atMs) })
    .returning({ id: schema.waves.id }))[0];
  const algoKey = `${rule.warehouseId}|${ruleKey === "b2b" ? "B2B Default" : "Default"}`;
  const result = list.length === 0 ? null : await allocation.allocateOrders(tx, ctx, {
    orderIds: list.map((c) => c.id), warehouseId: rule.warehouseId, algorithmId: w.config.allocationAlgorithms.get(algoKey) ?? null,
    waveId: wave.id, waveNo, waveRuleName: rule.name, runBy, mode: "full",
  });
  if (result) checkBulk(w, `wave ${waveNo} allocate`, result);
  const allocated = new Set(result?.allocated ?? []);
  const byType = new Map<JobTypeCode, Id[]>();
  for (const c of list.filter((x) => allocated.has(x.id))) {
    const code = jobTypeFor(c);
    byType.set(code, [...(byType.get(code) ?? []), c.id]);
  }
  const jobIds: Id[] = [];
  for (const [code, orderIds] of byType) {
    const jobTypeId = w.config.jobTypes.get(jobTypeKey(rule.warehouseId, code));
    if (!jobTypeId) continue;
    const created = await jobs.createJobsFromOrders(tx, ctx, { orderIds, jobTypeId, waveId: wave.id, waveNo, priority: ruleKey === "rush" ? "Urgent" : ruleRow.priority });
    checkBulk(w, `wave ${waveNo} jobs`, created);
    jobIds.push(...created.jobIds);
  }
  if (jobIds.length > 0) await tx.update(schema.jobs).set({ ruleName: rule.name, waveRuleId: rule.id }).where(inArray(schema.jobs.id, jobIds));
  const shortage = result?.shortage.length ?? 0;
  await tx.update(schema.waves).set({
    status: "Completed", ordersMet: list.length, allocatedOrders: allocated.size, shortageOrders: shortage, jobsCreated: jobIds.length,
    message: list.length === 0 ? "No orders met the wave conditions." : shortage > 0 ? `${shortage} order(s) could not be fully allocated.` : null,
    finishedAt: isoOf(atMs + 2 * MINUTE_MS),
  }).where(eq(schema.waves.id, wave.id));
  await tx.update(schema.waveRules).set({ runCount, lastRunAt: isoOf(atMs), lastRunBy: runBy, lastWaveNo: waveNo }).where(eq(schema.waveRules.id, rule.id));
  return { jobIds };
}

async function assignJobs(w: World, tx: Tx, ctx: DomainCtx, code: WarehouseCode, jobIds: readonly Id[], seed: number): Promise<void> {
  await forEachSeq(jobIds, async (jobId, i) => {
    const picker = operatorFor(w, code, seed + i);
    checkBulk(w, "assign job", await jobs.assign(tx, ctx, { jobIds: [jobId], userId: picker.id }));
  });
}

function scheduleSlot(w: World, slot: WaveSlot, atMs: number, n: number): void {
  const code = warehouseOf(slot.rule);
  const rule = w.config.waveRules[slot.rule];
  w.queue.schedule(atMs, `wave ${rule.name}`, async () => {
    const runner = slot.manual ? (code === "KS2" ? operatorFor(w, "KS2", 0) : w.access.manager) : null;
    const ctx = runner ? actor(runner) : integrationCtx;
    const runBy = runner ? runner.name : "Integration";
    const outcome = await txAt(w.env, atMs, async (tx) => await runWave(w, tx, ctx, rule, slot.rule, atMs, runBy));
    if (outcome.jobIds.length === 0) return;
    await txAt(w.env, atMs + MINUTE_MS, async (tx) => await assignJobs(w, tx, actor(w.access.manager), code, outcome.jobIds, n));
    outcome.jobIds.forEach((jobId, i) => schedulePickJob(w, code, jobId, atMs + (25 + i * 12 + w.env.rng.int(0, 20)) * MINUTE_MS));
  });
}

/** Schedules every wave slot of the replay window (weekday schedules + manual runs). */
export function scheduleWaves(w: World): number {
  let n = 0;
  for (let daysAgo = REPLAY_DAYS - 1; daysAgo >= 0; daysAgo -= 1) {
    for (const slot of SLOTS) {
      const at = utcAt(daysAgo, slot.hour, slot.minute);
      const adHoc = slot.adHocToday === true && daysAgo === 0;
      if ((!slot.days.includes(weekdayOf(at)) && !adHoc) || (slot.adHocToday && !adHoc) || at > w.endMs) continue;
      try {
        scheduleSlot(w, slot, at, n);
        n += 1;
      } catch (error) {
        noteFailure(w, `schedule wave ${slot.rule}`, error);
      }
    }
  }
  return n;
}
