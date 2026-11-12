/**
 * "Linked WMS client" contracts: Zod input schemas + DTO types shared by the WMS link
 * service, the `/api/v1/crm/wms/**` + `/api/v1/crm/accounts/[itemId]/wms-link` routes and
 * the client (`src/features/crm`). Client-safe: zod + types only.
 */
import { z } from 'zod';

export const coreCustomersQuerySchema = z.object({
  /** Matches customer name or code (case-insensitive substring). */
  search: z.string().trim().max(200).optional(),
});
export type CoreCustomersQuery = z.infer<typeof coreCustomersQuerySchema>;

/** `coreCustomerId: null` removes the link. */
export const setCustomerLinkSchema = z.object({ coreCustomerId: z.uuid().nullable() });
export type SetCustomerLinkInput = z.infer<typeof setCustomerLinkSchema>;

/** A `core.customers` row as the CRM shows it (shared WMS client registry). */
export interface CoreCustomerDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

/**
 * Small operational peek for a linked client, read from the WMS tables in the shared
 * Postgres (`wms.shipment_orders` / `wms.inventory`). Null when the WMS schema is not
 * deployed alongside the CRM — the card then stays identity-only (fail-soft).
 */
export interface WmsOpsPeekDto {
  /** Shipment orders not yet shipped, delivered or cancelled. */
  readonly openOrders: number;
  /** Units on hand across warehouses. */
  readonly onHandUnits: number;
}

/** The WMS client linked to an account board item (null when unlinked). */
export interface WmsLinkDto {
  readonly customer: CoreCustomerDto | null;
  readonly ops: WmsOpsPeekDto | null;
}
