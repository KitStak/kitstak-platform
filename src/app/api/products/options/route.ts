/** `GET /api/products/options?for=grid|wizard&clientId=` — filter / wizard option lists. M09. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { getGridOptions, getWizardOptions } from "@/server/repositories/products-options";

export const GET = defineRoute({
  permission: "settings.products.view",
  query: z.object({ for: z.enum(["grid", "wizard"]).default("grid"), clientId: z.string().trim().max(64).optional() }),
  handler: ({ db, auth, query }) => (query.for === "grid" ? getGridOptions(db, auth.viewScope) : getWizardOptions(db, auth.scope, query.clientId ?? null)),
});
