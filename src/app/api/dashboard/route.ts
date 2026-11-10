/**
 * `GET /api/dashboard?wh=<id,id>&cl=<id,id>` — live dashboard widgets (M13 §1). An empty
 * selection falls back to the header context; ids outside the viewer's scope are ignored.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { getLiveDashboard } from "@/server/repositories/dashboard-live";

const idList = z
  .string()
  .max(4000)
  .optional()
  .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200) : []));

export const GET = defineRoute({
  name: "GET /api/dashboard",
  query: z.object({ wh: idList, cl: idList }),
  handler: ({ db, auth, query }) => getLiveDashboard(db, auth, { warehouseIds: query.wh, clientIds: query.cl }),
});
