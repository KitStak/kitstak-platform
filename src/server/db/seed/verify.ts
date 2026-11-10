/**
 * Database-wide integrity checks behind `npm run db:verify` (BUILD_PLAN 0.4 #6):
 * the ledger reconciliation from the domain (bucket balances, allocations, line quantities,
 * PO receipts, client present) plus checks the ledger does not cover on its own.
 */
import { sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { reconcileLedger } from "@/server/domain/ledger";

export interface VerifyIssue {
  readonly check: string;
  readonly id: string;
  readonly message: string;
}

export interface VerifyResult {
  readonly issues: readonly VerifyIssue[];
  readonly stats: Readonly<Record<string, number>>;
}

interface RawCheck {
  readonly check: string;
  readonly sql: string;
  readonly message: (row: Record<string, unknown>) => string;
}

const EXTRA_CHECKS: readonly RawCheck[] = [
  {
    check: "legacy_bucket", sql: "SELECT id FROM inventory WHERE bucket_key LIKE 'legacy:%'",
    message: () => "inventory row was written outside the ledger (placeholder bucket key)",
  },
  {
    check: "txn_client", sql: "SELECT id FROM inventory_transactions WHERE client_id IS NULL OR client_id = ''",
    message: () => "inventory transaction has no client",
  },
  {
    check: "allocation_bucket", sql: "SELECT a.id FROM inventory_allocations a LEFT JOIN inventory i ON i.id = a.inventory_id WHERE i.id IS NULL",
    message: () => "allocation points at a missing inventory bucket",
  },
  {
    check: "line_downstream", sql: `SELECT id, picked_quantity AS picked, packed_quantity AS packed, shipped_quantity AS shipped FROM order_lines
      WHERE packed_quantity > picked_quantity OR shipped_quantity > packed_quantity`,
    message: (r) => `shipped ${String(r.shipped)} <= packed ${String(r.packed)} <= picked ${String(r.picked)} violated`,
  },
  {
    check: "po_line_received", sql: `SELECT l.id, l.received_quantity AS received,
      COALESCE((SELECT SUM(r.quantity) FROM receipts r WHERE r.purchase_order_line_id = l.id AND r.cancelled_at IS NULL), 0) AS receipts
      FROM purchase_order_lines l WHERE l.received_quantity <> COALESCE((SELECT SUM(r.quantity) FROM receipts r WHERE r.purchase_order_line_id = l.id AND r.cancelled_at IS NULL), 0)`,
    message: (r) => `line received ${String(r.received)} but receipts sum ${String(r.receipts)}`,
  },
  {
    check: "return_line_received", sql: `SELECT l.id, l.returned_qty AS returned,
      COALESCE((SELECT SUM(r.quantity) FROM receipts r WHERE r.return_order_line_id = l.id AND r.cancelled_at IS NULL), 0) AS receipts
      FROM return_order_lines l WHERE l.returned_qty <> COALESCE((SELECT SUM(r.quantity) FROM receipts r WHERE r.return_order_line_id = l.id AND r.cancelled_at IS NULL), 0)`,
    message: (r) => `return line returned ${String(r.returned)} but receipts sum ${String(r.receipts)}`,
  },
  {
    check: "serial_stock", sql: `SELECT i.id, i.on_hand AS onHand, (SELECT COUNT(*) FROM serial_numbers s WHERE s.inventory_id = i.id AND s.status IN ('Received','Updated')) AS serials
      FROM inventory i JOIN products p ON p.id = i.product_id
      WHERE p.track_serial = 1 AND i.status = 'Stock' AND i.on_hand > 0 AND i.on_hand <> (SELECT COUNT(*) FROM serial_numbers s WHERE s.inventory_id = i.id AND s.status IN ('Received','Updated'))`,
    message: (r) => `serial-tracked bucket holds ${String(r.onHand)} units but ${String(r.serials)} serials`,
  },
  {
    check: "shipped_without_label", sql: `SELECT o.id FROM shipment_orders o WHERE o.status IN ('Shipped','Delivered','Partially Shipped')
      AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.label_type = 'Shipping Label' AND s.label_status = 'Active')`,
    message: () => "shipped order has no active shipping label",
  },
];

const STATS: Readonly<Record<string, string>> = {
  buckets: "SELECT COUNT(*) AS n FROM inventory",
  transactions: "SELECT COUNT(*) AS n FROM inventory_transactions",
  activeAllocations: "SELECT COUNT(*) AS n FROM inventory_allocations WHERE status IN ('Allocated','Picked','Sorted','Packed','Loaded')",
  orderLines: "SELECT COUNT(*) AS n FROM order_lines",
  receipts: "SELECT COUNT(*) AS n FROM receipts",
  onHandUnits: "SELECT COALESCE(SUM(on_hand), 0) AS n FROM inventory",
};

export function verifyDatabase(db: AppDb): VerifyResult {
  const ledgerIssues: VerifyIssue[] = reconcileLedger(db).map((i) => ({ check: i.check, id: i.id, message: i.message }));
  const extra = EXTRA_CHECKS.flatMap((c) => db.all<Record<string, unknown>>(sql.raw(c.sql)).map((row) => ({ check: c.check, id: String(row.id), message: c.message(row) })));
  const stats = Object.fromEntries(Object.entries(STATS).map(([k, q]) => [k, Number(db.get<{ n: number }>(sql.raw(q))?.n ?? 0)]));
  return { issues: [...ledgerIssues, ...extra], stats };
}
