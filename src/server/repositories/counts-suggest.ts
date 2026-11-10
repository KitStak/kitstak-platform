/**
 * AI Count Plan suggestion (M07): ranks a warehouse's stocked locations (Location count) or SKUs
 * (SKU count) by count risk, using real history only:
 *   - staleness: days since the last count entry (never counted ranks highest);
 *   - velocity: physical movements in the last 30 days (picks, moves, receipts, replenishment,
 *     adjustments, kitting, returns);
 *   - accuracy: past count entries that differed from the system quantity (180 days);
 *   - ABC class of the location (Location count).
 * Locations / SKUs already in an open count are left out; Location suggestions cover storage and
 * pick locations only (stations, ramps and virtual locations hold transient stock). The wizard adds the top N and saves the
 * plan with AI Count Plan = Yes.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import { notFoundError } from "@/server/api/errors";
import { hasWarehouse, type Scope } from "@/server/auth/scope";
import { scoreCountRisk } from "@/lib/grid-defs/counts/count-math";
import { inList, raw } from "./counts-grid";

export const countSuggestQuerySchema = z.object({
  warehouseId: z.string().min(1, "Choose a warehouse first").max(64),
  countType: z.enum(["Location", "SKU"]),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export interface CountSuggestion {
  readonly id: string;
  readonly label: string;
  readonly sub1: string | null;
  readonly sub2: string | null;
  readonly onHand: number;
  readonly score: number;
  readonly reasons: readonly string[];
}

const MOVE_TYPES = "('Picking', 'Inventory Movement', 'Receiving', 'Replenishment', 'Return Receiving', 'Inventory Adjustment', 'Kitting', 'Disassemble Kit')";
const OPEN_LINE = "('Pending', 'Ready To Count', 'Count Started', 'Count Completed')";

interface Raw { id: string; label: string; sub1: string | null; sub2: string | null; onHand: number; lastCount: string | null; moves: number; variances: number; abc: string | null }

const daysSince = (iso: string | null, now: number): number | null => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000)) : null);

export function suggestCountTargets(db: AppDb, scope: Scope, input: z.output<typeof countSuggestQuerySchema>): CountSuggestion[] {
  if (!hasWarehouse(scope, input.warehouseId)) throw notFoundError("Warehouse");
  const wh = input.warehouseId;
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const since180 = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const clientScope = scope.clientIds === "all" ? raw("1 = 1") : inList(raw("i.client_id"), scope.clientIds);

  // One grouped pass per signal (no per-row correlated scans): movements, last count and past variances.
  const moves = sql`SELECT loc, COUNT(*) AS n FROM (
      SELECT t.from_location_id AS loc FROM inventory_transactions t WHERE t.warehouse_id = ${wh} AND t.at >= ${since30} AND t.type IN ${raw(MOVE_TYPES)} AND t.from_location_id IS NOT NULL
      UNION ALL SELECT t.to_location_id FROM inventory_transactions t WHERE t.warehouse_id = ${wh} AND t.at >= ${since30} AND t.type IN ${raw(MOVE_TYPES)} AND t.to_location_id IS NOT NULL
    ) GROUP BY loc`;
  const entries = sql`SELECT e.location_id AS loc, e.product_id AS pid, e.counted_at AS at, CASE WHEN e.counted_at >= ${since180} AND e.counted_qty <> e.system_qty THEN 1 ELSE 0 END AS var
    FROM count_line_entries e JOIN count_plan_lines l ON l.id = e.line_id JOIN count_plans p ON p.id = l.plan_id WHERE p.warehouse_id = ${wh}`;

  const rows = input.countType === "Location"
    ? db.all<Raw>(sql`
        WITH mv AS (${moves}), ce AS (SELECT loc, MAX(at) AS lastCount, SUM(var) AS variances FROM (${entries}) GROUP BY loc)
        SELECT lo.id, lo.code AS label, lo.location_type AS sub1, lg.name AS sub2, stock.on_hand AS onHand, lo.abc_code AS abc,
          ce.lastCount, COALESCE(mv.n, 0) AS moves, COALESCE(ce.variances, 0) AS variances
        FROM locations lo
        JOIN (SELECT i.location_id AS lid, SUM(i.on_hand) AS on_hand FROM inventory i WHERE i.warehouse_id = ${wh} AND i.on_hand > 0 AND ${clientScope} GROUP BY i.location_id) stock ON stock.lid = lo.id
        LEFT JOIN lookup_values lg ON lg.id = lo.location_group_id
        LEFT JOIN mv ON mv.loc = lo.id LEFT JOIN ce ON ce.loc = lo.id
        WHERE lo.warehouse_id = ${wh} AND lo.is_active = 1
          -- storage and pick faces only: stations, ramps and virtual locations hold transient stock
          AND lo.area_type IN ('Storage', 'Picking') AND COALESCE(lo.location_type, '') NOT IN ('Virtual', 'BusinessStation')
          AND lo.id NOT IN (SELECT l.location_id FROM count_plan_lines l JOIN count_plans p ON p.id = l.plan_id
            WHERE l.location_id IS NOT NULL AND l.status IN ${raw(OPEN_LINE)} AND p.status NOT IN ('Cancelled', 'Inventory Updated'))`)
    : db.all<Raw>(sql`
        WITH mv AS (SELECT t.product_id AS pid, COUNT(*) AS n FROM inventory_transactions t WHERE t.warehouse_id = ${wh} AND t.at >= ${since30} AND t.type IN ${raw(MOVE_TYPES)} GROUP BY t.product_id),
          ce AS (SELECT pid, MAX(at) AS lastCount, SUM(var) AS variances FROM (${entries}) GROUP BY pid)
        SELECT pr.id, pr.sku AS label, pt.name AS sub1, pg.name AS sub2, stock.on_hand AS onHand, NULL AS abc,
          ce.lastCount, COALESCE(mv.n, 0) AS moves, COALESCE(ce.variances, 0) AS variances
        FROM products pr
        JOIN (SELECT i.product_id AS pid, SUM(i.on_hand) AS on_hand FROM inventory i WHERE i.warehouse_id = ${wh} AND i.on_hand > 0 AND ${clientScope} GROUP BY i.product_id) stock ON stock.pid = pr.id
        LEFT JOIN lookup_values pt ON pt.id = pr.product_type_id LEFT JOIN lookup_values pg ON pg.id = pr.product_group_id
        LEFT JOIN mv ON mv.pid = pr.id LEFT JOIN ce ON ce.pid = pr.id
        WHERE pr.id NOT IN (SELECT l.product_id FROM count_plan_lines l JOIN count_plans p ON p.id = l.plan_id WHERE l.product_id IS NOT NULL AND p.warehouse_id = ${wh}
          AND l.status IN ${raw(OPEN_LINE)} AND p.status NOT IN ('Cancelled', 'Inventory Updated'))`);

  const now = Date.now();
  const maxMoves = rows.reduce((m, r) => Math.max(m, Number(r.moves)), 0);
  return rows
    .map((r) => {
      const risk = scoreCountRisk({ daysSinceCount: daysSince(r.lastCount, now), moves: Number(r.moves), pastVariances: Number(r.variances), abcCode: r.abc }, maxMoves);
      return { id: r.id, label: r.label, sub1: r.sub1, sub2: r.sub2, onHand: Number(r.onHand), score: risk.score, reasons: risk.reasons };
    })
    .sort((a, b) => b.score - a.score || b.onHand - a.onHand || a.label.localeCompare(b.label))
    .slice(0, input.limit);
}
