/**
 * Ledger reconciliation (BUILD_PLAN 0.4 #6). Shared by unit tests and
 * `scripts/verify-ledger.ts` (`npm run db:verify`, F8).
 */
import { sql } from "drizzle-orm";
import type { Tx } from "../types";

export interface LedgerIssue {
  readonly check: "bucket_balance" | "bucket_allocated" | "bucket_negative" | "allocated_exceeds_available" | "line_quantities" | "po_received" | "missing_client";
  readonly id: string;
  readonly message: string;
}

const ACTIVE = `('Allocated','Picked','Sorted','Packed','Loaded')`;

export function reconcileLedger(tx: Tx): LedgerIssue[] {
  const issues: LedgerIssue[] = [];
  const balances = tx.all<{ id: string; onHand: number; ledger: number }>(sql.raw(`
    SELECT i.id, i.on_hand AS onHand,
      COALESCE((SELECT SUM(uom_qty) FROM inventory_transactions t WHERE t.to_inventory_id = i.id), 0)
      - COALESCE((SELECT SUM(uom_qty) FROM inventory_transactions t WHERE t.from_inventory_id = i.id), 0) AS ledger
    FROM inventory i WHERE i.bucket_key NOT LIKE 'legacy:%'`));
  for (const b of balances) {
    if (b.onHand !== b.ledger) issues.push({ check: "bucket_balance", id: b.id, message: `on-hand ${b.onHand} but ledger sum ${b.ledger}` });
  }
  const allocs = tx.all<{ id: string; allocated: number; active: number; onHand: number; damaged: number; clientId: string | null }>(sql.raw(`
    SELECT i.id, i.allocated, i.on_hand AS onHand, i.damaged, i.client_id AS clientId,
      COALESCE((SELECT SUM(a.qty) FROM inventory_allocations a WHERE a.inventory_id = i.id AND a.status IN ${ACTIVE}), 0) AS active
    FROM inventory i`));
  for (const a of allocs) {
    if (a.allocated !== a.active) issues.push({ check: "bucket_allocated", id: a.id, message: `allocated ${a.allocated} but active allocations ${a.active}` });
    if (a.onHand < 0) issues.push({ check: "bucket_negative", id: a.id, message: `on-hand ${a.onHand} is negative` });
    if (a.allocated > a.onHand - a.damaged) issues.push({ check: "allocated_exceeds_available", id: a.id, message: `allocated ${a.allocated} > on-hand ${a.onHand} - damaged ${a.damaged}` });
    if (!a.clientId) issues.push({ check: "missing_client", id: a.id, message: "inventory row has no client" });
  }
  const lines = tx.all<{ id: string; quantity: number; allocated: number; picked: number }>(sql.raw(`
    SELECT id, quantity, allocated_quantity AS allocated, picked_quantity AS picked FROM order_lines
    WHERE picked_quantity > allocated_quantity OR allocated_quantity > quantity`));
  for (const l of lines) issues.push({ check: "line_quantities", id: l.id, message: `picked ${l.picked} <= allocated ${l.allocated} <= quantity ${l.quantity} violated` });
  const pos = tx.all<{ id: string; received: number; receipts: number }>(sql.raw(`
    SELECT p.id, p.received_quantity AS received,
      COALESCE((SELECT SUM(r.quantity) FROM receipts r WHERE r.purchase_order_id = p.id AND r.cancelled_at IS NULL), 0) AS receipts
    FROM purchase_orders p WHERE EXISTS (SELECT 1 FROM receipts r WHERE r.purchase_order_id = p.id)`));
  for (const p of pos) {
    if (p.received !== p.receipts) issues.push({ check: "po_received", id: p.id, message: `received ${p.received} but receipts sum ${p.receipts}` });
  }
  return issues;
}
