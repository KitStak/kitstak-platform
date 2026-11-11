/**
 * `GET /api/returns/shippable?orderIds=a,b` — shipped lines and returnable quantities (Create RMA).
 * Query contract: `orderIds` is a comma-separated list of shipment order ids (max 50, deduped).
 * Repeated `orderId=` params are also accepted and merged. Missing ids come back as `{ id, missing: true }`.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { RETURN_PERMISSIONS, shippableOrder } from "@/server/repositories/returns";
import { mapSeq } from "@/server/db/sql";

export const GET = defineRoute({
  permission: RETURN_PERMISSIONS.createRma,
  query: z.object({
    orderIds: z.string({ error: "Choose a shipped order (orderIds=id1,id2)" }).max(4000).optional(),
    orderId: z.union([z.string(), z.array(z.string())]).optional(),
  }).refine((q) => Boolean(q.orderIds?.trim()) || Boolean(q.orderId), { message: "Choose a shipped order (orderIds=id1,id2)" }),
  handler: async ({ db, auth, query }) => {
    const raw = [query.orderIds ?? "", ...[query.orderId ?? []].flat()].join(",");
    const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 50);
    return await mapSeq(ids, async (id) => {
      try {
        return await shippableOrder(db, auth.scope, id);
      } catch (error) {
        if (error instanceof AppError && error.code === "NOT_FOUND") return { id, missing: true as const };
        throw error;
      }
    });
  },
});
