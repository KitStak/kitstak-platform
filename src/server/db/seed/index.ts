/**
 * `runSeed(db, opts)`: builds the KitStaks demo tenant (BUILD_PLAN F2).
 *
 *  1. Wipe every table in place.
 *  2. Setup (60+ days back): organization, access, lookups, catalog, facility, integrations, config.
 *  3. Opening balance migrated from Logiwa Classic (34 days back).
 *  4. A 30-day replay of domain operations on a time-ordered event queue: POs and receipts,
 *     orders, waves, picking and packing, labels and shipping, returns, counts, kitting,
 *     replenishment, adjustments and nightly snapshots. It stops at the anchor ("now").
 *  5. Derived history and platform data: shipment plans, channel logs, billing, tags, notifications.
 *
 * Deterministic: the same seed number yields the same rows, ids and timestamps.
 */
import { eq, sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import * as schema from "@/server/db/schema";
import { ledger, type LedgerIssue } from "@/server/domain/ledger";
import type { FileStore } from "@/server/files";
import { Rng } from "../seed-data";
import { DEFAULT_SEED_PASSWORD, seedAccess, seedAuditTrail } from "./access";
import { retireProducts, seedCatalog } from "./catalog";
import { seedConfig } from "./config";
import { seedCartOccupancy, seedFacility } from "./facility";
import { seedBilling } from "./billing";
import { seedChannelHistory, seedShipmentPlans } from "./history";
import { scheduleInbound } from "./inbound";
import { seedCarriers, seedChannels } from "./integrations";
import { seedLookups, seedSequences } from "./lookups";
import { scheduleWorkOrders } from "./kitting";
import { scheduleCounts } from "./counts";
import { postOpeningBalance, resetSerials } from "./opening";
import { seedOrg } from "./org";
import { REPLAY_DAYS, scheduleOrders } from "./outbound";
import { seedPlatform } from "./platform";
import { createEventQueue } from "./queue";
import { listDataTables, wipeAllRows } from "./reset";
import { resetReturnState, scheduleReturns } from "./returns";
import { ANCHOR_MS, installRuntime, isRuntimeInstalled, setClock, uninstallRuntime, utcAt } from "./runtime";
import { resetShippingState, scheduleCarrierPickups } from "./shipping";
import { scheduleAdjustments, scheduleReplenishment, scheduleSnapshots } from "./stock";
import { txAt, type SeedEnv } from "./types";
import { scheduleWaves } from "./waves";
import { resetWorkState } from "./work";
import { managerCtx, noteFailure, type World } from "./world";
import { repairPoStatusDrift } from "@/server/repositories/purchase-orders-integrity";
import { recalcKitInventory } from "@/server/repositories/kits";

export const DEFAULT_SEED = 20261105;

export interface SeedOptions {
  readonly files: FileStore;
  readonly password?: string;
  readonly seed?: number;
}

export interface SeedReport {
  readonly counts: Readonly<Record<string, number>>;
  readonly events: number;
  readonly failures: number;
  readonly failureSamples: readonly string[];
  readonly ledgerIssues: readonly LedgerIssue[];
}

function setup(env: SeedEnv, password: string) {
  return txAt(env, utcAt(60, 14), (tx) => {
    const org = seedOrg(env, tx);
    const access = seedAccess(tx, org, password);
    const lookups = seedLookups(tx, org);
    seedSequences(tx);
    const catalog = seedCatalog(env, tx, org, lookups);
    const facility = seedFacility(tx, org, catalog, lookups);
    const carriers = seedCarriers(tx, org);
    const channels = seedChannels(tx, org, catalog);
    const config = seedConfig(tx, org, carriers);
    return { org, access, lookups, catalog, facility, carriers, channels, config };
  });
}

function scheduleHistory(w: World): void {
  scheduleInbound(w);
  scheduleOrders(w);
  scheduleWaves(w);
  scheduleCarrierPickups(w, REPLAY_DAYS);
  scheduleReplenishment(w);
  scheduleAdjustments(w);
  scheduleCounts(w);
  scheduleWorkOrders(w);
  scheduleReturns(w);
  scheduleSnapshots(w);
}

function finish(w: World): void {
  txAt(w.env, ANCHOR_MS - 60_000, (tx) => {
    seedShipmentPlans(w, tx);
    seedChannelHistory(w, tx);
    seedBilling(w, tx);
    seedPlatform(w, tx);
    seedAuditTrail(tx, w.access);
    retireProducts(tx, w.catalog);
    // Fully received seeded POs settle to Completed (and none stays in the transient Receiving),
    // the same way receiving does (inbound-receiving REQ-R2-9).
    repairPoStatusDrift(tx, managerCtx(w));
    // Two open picking jobs on mobile carts, each order in a cell (M10 / REQ-R10-6).
    seedCartOccupancy(tx, managerCtx(w), w.org.mlt1);
    const pxp = w.org.clientByCode.get("PXP");
    if (pxp) tx.update(schema.clients).set({ status: "Inactive" }).where(eq(schema.clients.id, pxp.id)).run();
  });
}

export function countRows(db: AppDb): Record<string, number> {
  return Object.fromEntries(listDataTables(db).map((t) => [t, db.get<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM "${t}"`))?.n ?? 0]));
}

export async function runSeed(db: AppDb, opts: SeedOptions): Promise<SeedReport> {
  if (isRuntimeInstalled()) throw new Error("A seed is already running in this process");
  const seed = opts.seed ?? DEFAULT_SEED;
  installRuntime(seed, utcAt(60, 14));
  try {
    resetSerials();
    resetWorkState();
    resetShippingState();
    resetReturnState();
    wipeAllRows(db);
    const env: SeedEnv = { db, rng: new Rng(seed), files: opts.files };
    const refs = setup(env, opts.password ?? DEFAULT_SEED_PASSWORD);
    const w: World = { env, queue: createEventQueue(ANCHOR_MS), endMs: ANCHOR_MS, ...refs, orders: new Map(), counters: { events: 0, failures: 0, failureSamples: [] } };
    const openingAt = utcAt(34, 13);
    txAt(env, openingAt, (tx) => postOpeningBalance(w, tx, openingAt));
    scheduleHistory(w);
    w.counters.events = await w.queue.drain({ before: setClock, onError: (label, error) => noteFailure(w, label, error) });
    finish(w);
    // Kit Inventory reads a derived snapshot: stamp it at seed time so a fresh install never reads "Last updated never".
    try { recalcKitInventory(db); } catch (error) { noteFailure(w, "kit inventory recalc", error); }
    return {
      counts: countRows(db), events: w.counters.events, failures: w.counters.failures, failureSamples: [...w.counters.failureSamples],
      ledgerIssues: ledger.reconcileLedger(db),
    };
  } finally {
    uninstallRuntime();
  }
}
