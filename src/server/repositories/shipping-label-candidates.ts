/**
 * Create label dialog (Carrier Shipment Details and plan detail Orders tab): the orders that can get a
 * shipping label now, with the carrier and service the label would use. Labels are then created through
 * `POST /api/orders/bulk/labels` (`action: "create"`), the same path as Shipment Orders → Label → Create.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import { scopeSql } from "./shipping-grid";

/** Statuses the label domain accepts (`shipping.createLabel`). */
export const LABELABLE_ORDER_STATUSES = ["Open", "Ready to Pick", "Packing Started", "Ready to Load", "Loading Started", "Ready to Ship", "Partially Shipped"] as const;

export interface LabelCandidate {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly warehouseCode: string;
  readonly clientName: string | null;
  readonly customerName: string;
  /** "UPS-TEST - UPS Ground" when the order names a carrier service; null = the label is rate-shopped. */
  readonly carrierService: string | null;
  readonly weightOz: number;
  /** Active shipping labels already on the order (a second label needs a void first). */
  readonly activeLabels: number;
  /** Why a label can't be created right now, or null. */
  readonly blockedReason: string | null;
}

const raw = (s: string): SQL => sql.raw(s);

/** Why an order can't get a label (PURE). */
export function labelBlockReason(status: string, activeLabels: number): string | null {
  if (!(LABELABLE_ORDER_STATUSES as readonly string[]).includes(status)) return `A label can't be created for a ${status} order`;
  if (activeLabels > 0) return "The order already has an active label. Void it first to relabel.";
  return null;
}

export function labelCandidates(db: AppDb, auth: AuthContext, input: { readonly q?: string; readonly planId?: string }): readonly LabelCandidate[] {
  const scope = scopeSql(raw("o.warehouse_id"), raw("o.client_id"), auth.viewScope);
  const q = input.q?.trim();
  const search = q ? sql`AND (o.code LIKE ${`%${q}%`} OR o.customer_name LIKE ${`%${q}%`} OR o.store_order_number LIKE ${`%${q}%`})` : sql``;
  const plan = input.planId ? sql`AND o.id IN (SELECT order_id FROM shipment_plan_orders WHERE plan_id = ${input.planId})` : sql``;
  // Without a plan, list only orders that could take a label; on a plan, list every order so the dialog explains the rest.
  const statusFilter = input.planId ? sql`` : sql`AND o.status IN (${sql.join(LABELABLE_ORDER_STATUSES.map((s) => sql`${s}`), sql`, `)})`;
  const rows = db.all<Omit<LabelCandidate, "blockedReason">>(sql`
    SELECT o.id AS id, o.code AS code, o.status AS status, w.code AS warehouseCode, c.name AS clientName, o.customer_name AS customerName,
      CASE WHEN cs.id IS NOT NULL THEN COALESCE(cc.setup_name || ' - ', '') || cs.name END AS carrierService, o.total_weight_oz AS weightOz,
      (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id AND s.label_type = 'Shipping Label' AND s.label_status = 'Active') AS activeLabels
    FROM shipment_orders o
    JOIN warehouses w ON w.id = o.warehouse_id
    LEFT JOIN clients c ON c.id = o.client_id
    LEFT JOIN carrier_connections cc ON cc.id = o.carrier_connection_id
    LEFT JOIN carrier_services cs ON cs.id = o.carrier_service_id
    WHERE o.deleted_at IS NULL AND ${scope} ${statusFilter} ${plan} ${search}
    ORDER BY CASE WHEN (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id AND s.label_type = 'Shipping Label' AND s.label_status = 'Active') = 0 THEN 0 ELSE 1 END, o.code DESC
    LIMIT 50`);
  return rows.map((r) => ({ ...r, activeLabels: Number(r.activeLabels), weightOz: Number(r.weightOz ?? 0), blockedReason: labelBlockReason(r.status, Number(r.activeLabels)) }));
}
