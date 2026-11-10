/** `GET /api/rate-shopping-presets/options?warehouseId&clientId` — active presets for pickers. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { presetOptions } from "@/server/repositories/rate-shopping";

export const GET = defineRoute({
  permission: ["automation.rate_shopping.view", "automation.workflows.view"],
  query: z.object({ warehouseId: z.string().max(64).optional(), clientId: z.string().max(64).optional() }),
  handler: ({ db, auth, query }) => presetOptions(db, auth, query),
});
