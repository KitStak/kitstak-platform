/**
 * AI job optimizer (Logiwa iO "AI Job" waves). PURE: no database access, fully unit-tested.
 *
 * An AI wave allocates its orders like a picking wave, then the optimizer:
 *   1. regroups the allocated orders into AI job types:
 *      - AI-SingleItemBatchPick: single-unit orders, batched by pick-face proximity;
 *      - AI-IdenticalOrderBatchPick: orders with identical content (same SKUs and quantities);
 *      - AI-OrderBasedPickPack: every other order, picked and packed one order per job;
 *   2. sequences each job's pick stops on a walking-distance model of the warehouse
 *      (nearest neighbour, then 2-opt), never longer than the walking-path order it replaces.
 *
 * Distance model: aisles are parallel and 3 m apart, bays 1.2 m wide; changing aisles goes
 * through the aisle front or back (whichever is shorter); the route starts and ends at the
 * front of the first aisle (the pack/induction area).
 */
export const AI_JOB_TYPES = ["AI-OrderBasedPickPack", "AI-IdenticalOrderBatchPick", "AI-SingleItemBatchPick"] as const;
export type AiJobType = (typeof AI_JOB_TYPES)[number];
export const AI_JOB_PREFIX = "AI-";

export const isAiJobType = (jobType: string | null | undefined): boolean => Boolean(jobType?.startsWith(AI_JOB_PREFIX));

export const AISLE_SPACING_M = 3;
export const BAY_WIDTH_M = 1.2;
export const BAYS_PER_RACK = 5;

export interface PickLocation {
  readonly id: string;
  readonly code: string;
  readonly aisle: string;
  readonly rack: string | null;
  readonly bay: string | null;
  readonly walkingPathPriority: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Aisle "A" → 0, "B" → 1 … ; numeric aisles keep their number; "00"/unknown → 0 (front/bulk). */
function aisleIndex(aisle: string): number {
  const a = aisle.trim().toUpperCase();
  if (/^\d+$/.test(a)) return Number(a);
  if (/^[A-Z]+$/.test(a)) return [...a].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  return 0;
}

const num = (v: string | null | undefined): number => {
  const m = /\d+/.exec(v ?? "");
  return m ? Number(m[0]) : 0;
};

export function locationPoint(loc: PickLocation): Point {
  const rack = num(loc.rack);
  const bay = num(loc.bay);
  if (rack === 0 && bay === 0) {
    // Bulk / dock / staging locations without rack coordinates: place them by walking path.
    return { x: 0, y: Math.max(0, loc.walkingPathPriority) / 100 };
  }
  return { x: aisleIndex(loc.aisle) * AISLE_SPACING_M, y: (Math.max(0, rack - 1) * BAYS_PER_RACK + Math.max(0, bay - 1)) * BAY_WIDTH_M + BAY_WIDTH_M / 2 };
}

export const DEPOT: Point = { x: 0, y: 0 };

/** Aisle depth used for the "go round the back" option. */
function depthOf(points: readonly Point[]): number {
  return Math.max(BAY_WIDTH_M * BAYS_PER_RACK, ...points.map((p) => p.y)) + BAY_WIDTH_M;
}

export function walkDistance(a: Point, b: Point, depth: number): number {
  if (Math.abs(a.x - b.x) < 1e-9) return Math.abs(a.y - b.y);
  const viaFront = a.y + b.y;
  const viaBack = (depth - a.y) + (depth - b.y);
  return Math.abs(a.x - b.x) + Math.min(viaFront, viaBack);
}

/** Closed tour length depot → stops (in order) → depot, in metres. */
export function routeLength(stops: readonly Point[], depth = depthOf(stops)): number {
  if (stops.length === 0) return 0;
  let total = walkDistance(DEPOT, stops[0] as Point, depth);
  for (let i = 1; i < stops.length; i += 1) total += walkDistance(stops[i - 1] as Point, stops[i] as Point, depth);
  return total + walkDistance(stops[stops.length - 1] as Point, DEPOT, depth);
}

/**
 * Optimized visiting order (indexes into `stops`): nearest neighbour from the depot, improved
 * with 2-opt. The result is never longer than `baseline` (the walking-path order); when the
 * heuristic cannot beat it, the baseline is returned unchanged.
 */
export function optimizeRoute(stops: readonly Point[], baseline: readonly number[] = stops.map((_, i) => i)): number[] {
  const n = stops.length;
  if (n <= 2) return [...baseline];
  const depth = depthOf(stops);
  const len = (order: readonly number[]) => routeLength(order.map((i) => stops[i] as Point), depth);
  const remaining = new Set(stops.map((_, i) => i));
  const order: number[] = [];
  let at: Point = DEPOT;
  while (remaining.size > 0) {
    let best = -1;
    let bestD = Infinity;
    for (const i of remaining) {
      const d = walkDistance(at, stops[i] as Point, depth);
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) < 1e-9 && i < best)) { best = i; bestD = d; }
    }
    order.push(best);
    remaining.delete(best);
    at = stops[best] as Point;
  }
  let improved = true;
  let guard = 0;
  let current = len(order);
  while (improved && guard < 50) {
    improved = false;
    guard += 1;
    for (let i = 0; i < n - 1; i += 1) {
      for (let k = i + 1; k < n; k += 1) {
        const candidate = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        const l = len(candidate);
        if (l < current - 1e-6) { order.splice(0, n, ...candidate); current = l; improved = true; }
      }
    }
  }
  return current <= len(baseline) + 1e-9 ? order : [...baseline];
}

/* ------------------------------------------------------------- order grouping */

export interface AiOrder {
  readonly id: string;
  readonly units: number;
  /** Content signature: sorted "productId×qty" list. */
  readonly signature: string;
  /** Pick-face points of the order's allocations. */
  readonly points: readonly Point[];
}

export interface AiGroup {
  readonly aiType: AiJobType;
  readonly orderIds: readonly string[];
}

function centroid(points: readonly Point[]): Point {
  if (points.length === 0) return DEPOT;
  return { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
}

/** Chunks orders into batches of at most `max`, ordered along the walk (aisle, then depth) so each batch stays compact. */
function proximityBatches(orders: readonly AiOrder[], max: number): string[][] {
  const sorted = [...orders].sort((a, b) => {
    const ca = centroid(a.points);
    const cb = centroid(b.points);
    return ca.x - cb.x || ca.y - cb.y || a.id.localeCompare(b.id);
  });
  const out: string[][] = [];
  for (let i = 0; i < sorted.length; i += max) out.push(sorted.slice(i, i + max).map((o) => o.id));
  return out;
}

export function groupForAi(orders: readonly AiOrder[], maxOrdersPerJob: number): AiGroup[] {
  const max = Math.max(1, Math.floor(maxOrdersPerJob));
  const singles = orders.filter((o) => o.units === 1);
  const multi = orders.filter((o) => o.units !== 1);
  const bySignature = new Map<string, AiOrder[]>();
  for (const o of multi) bySignature.set(o.signature, [...(bySignature.get(o.signature) ?? []), o]);
  const groups: AiGroup[] = [];
  for (const batch of proximityBatches(singles, max)) groups.push({ aiType: "AI-SingleItemBatchPick", orderIds: batch });
  const leftovers: AiOrder[] = [];
  for (const same of [...bySignature.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)) {
    if (same.length < 2) { leftovers.push(...same); continue; }
    for (const batch of proximityBatches(same, max)) {
      if (batch.length < 2) { leftovers.push(...same.filter((o) => batch.includes(o.id))); continue; }
      groups.push({ aiType: "AI-IdenticalOrderBatchPick", orderIds: batch });
    }
  }
  for (const o of [...leftovers].sort((a, b) => a.id.localeCompare(b.id))) groups.push({ aiType: "AI-OrderBasedPickPack", orderIds: [o.id] });
  return groups;
}

/* --------------------------------------------------------------- description */

export interface AiRouteStats {
  readonly stops: number;
  readonly optimizedM: number;
  readonly baselineM: number;
}

export function savingsPct(stats: AiRouteStats): number {
  if (stats.baselineM <= 0) return 0;
  return Math.max(0, Math.round((1 - stats.optimizedM / stats.baselineM) * 100));
}

/** "4 orders · 7 stops · 42 m walk (−18% vs walking path)". */
export function describeAiJob(orderCount: number, stats: AiRouteStats): string {
  const pct = savingsPct(stats);
  const walk = `${Math.round(stats.optimizedM)} m walk`;
  const vs = pct > 0 ? ` (−${pct}% vs walking path)` : " (already shortest)";
  return `${orderCount} ${orderCount === 1 ? "order" : "orders"} · ${stats.stops} ${stats.stops === 1 ? "stop" : "stops"} · ${walk}${vs}`;
}

/**
 * Route stats for a job's pick tasks: `sequenced` are the stops in task-sequence order. The
 * baseline is the walking-path order of the same distinct stops.
 */
export function routeStats(sequenced: readonly PickLocation[]): AiRouteStats {
  const seen = new Set<string>();
  const stops = sequenced.filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));
  const points = stops.map(locationPoint);
  const depth = depthOf(points);
  const baseline = [...stops].sort((a, b) => a.walkingPathPriority - b.walkingPathPriority || a.code.localeCompare(b.code)).map(locationPoint);
  return { stops: stops.length, optimizedM: routeLength(points, depth), baselineM: routeLength(baseline, depth) };
}
