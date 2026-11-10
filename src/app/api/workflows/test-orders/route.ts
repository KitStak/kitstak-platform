/** `GET /api/workflows/test-orders?q&kind` — records to test a workflow against (open orders, shipped orders or purchase orders). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { testOrderOptions } from "@/server/repositories/workflows";

export const GET = defineRoute({
  permission: "automation.workflows.view",
  query: z.object({ q: z.string().trim().max(60).optional(), kind: z.enum(["open", "shipped", "po"]).optional() }),
  handler: ({ db, auth, query }) => testOrderOptions(db, auth, query.q || null, query.kind ?? "open"),
});
