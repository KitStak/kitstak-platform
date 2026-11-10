/** `GET /api/counts/summary?kind=plans|locations|skus` — per-status totals for the grid status chips. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { COUNT_ANY_VIEW } from "@/lib/grid-defs/counts/count-grids";
import { countStatusSummary } from "@/server/repositories/counts-summary";

export const GET = defineRoute({
  permission: COUNT_ANY_VIEW,
  query: z.object({ kind: z.enum(["plans", "locations", "skus"]).default("plans") }),
  handler: ({ db, auth, query }) => countStatusSummary(db, auth.viewScope, query.kind),
});
