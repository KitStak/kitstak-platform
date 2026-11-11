/** `GET /api/algorithms/dry-run-orders?warehouseId&q` — open orders a dry run can target. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { dryRunOrderOptions } from "@/server/repositories/algorithms";

export const GET = defineRoute({
  permission: "automation.algorithms.test",
  query: z.object({ warehouseId: z.string().min(1).max(64), q: z.string().trim().max(60).optional() }),
  handler: async ({ db, auth, query }) => await dryRunOrderOptions(db, auth, query.warehouseId, query.q || null),
});
