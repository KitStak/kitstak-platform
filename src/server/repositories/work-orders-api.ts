/**
 * Shared glue for the `/api/work-orders/**` and `/api/kits/**` route handlers: permission
 * keys, zod contracts and the domain ctx (full scope, so cross-scope ids return 404).
 */
import { z } from "zod";
import type { AuthContext } from "@/server/auth/context";
import type { Scope } from "@/server/auth/scope";
import type { DomainCtx } from "@/server/domain/types";
import { PRIORITIES } from "@/lib/enums";
import { bulkIdsSchema, idSchema } from "./platform-common";

export const WO_PERMISSIONS = {
  view: "inventory.work_orders.view",
  create: "inventory.work_orders.create",
  edit: "inventory.work_orders.edit",
  delete: "inventory.work_orders.delete",
  createKit: "inventory.work_orders.create_kit",
  disassemble: "inventory.work_orders.disassemble_kit",
  picking: "inventory.work_orders.picking_job_operations",
  cancelPicking: "inventory.work_orders.cancel_picking",
  tag: "inventory.work_orders.tag",
} as const;

export const KIT_PERMISSIONS = {
  inventory: "reports.kit_inventory.view",
  components: "reports.kit_component_availability_report.view",
} as const;

export function woCtx(actor: { readonly userId: string | null; readonly source: string }, auth: AuthContext): DomainCtx & { readonly scope: Scope } {
  return { userId: actor.userId, source: actor.source, scope: auth.scope };
}

export const idsBodySchema = z.object({ ids: bulkIdsSchema });

export const pickingBodySchema = z.object({
  ids: bulkIdsSchema,
  jobTypeId: idSchema.nullish(),
  assigneeUserId: idSchema.nullish(),
  priority: z.enum(PRIORITIES).optional(),
  /** Evaluate only: runs inside a savepoint that is rolled back. */
  dryRun: z.boolean().optional(),
});

export const pickListBodySchema = z.object({ ids: bulkIdsSchema, consolidated: z.boolean().default(false) });
