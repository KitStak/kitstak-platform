/** `GET /api/workflows/test-orders?q` — open orders to test a workflow against. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { testOrderOptions } from "@/server/repositories/workflows";

export const GET = defineRoute({
  permission: "automation.workflows.view",
  query: z.object({ q: z.string().trim().max(60).optional() }),
  handler: ({ db, auth, query }) => testOrderOptions(db, auth, query.q || null),
});
