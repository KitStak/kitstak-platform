/** `GET /api/products/options?for=grid|wizard&clientId=` — filter / wizard option lists. M09. */
import { z } from "zod";
import { PRODUCT_READ_PERMISSIONS } from "@/lib/grid-defs/products/permissions";
import { defineRoute } from "@/server/api/define-route";
import { getGridOptions, getWizardOptions } from "@/server/repositories/products-options";

export const GET = defineRoute({
  permission: PRODUCT_READ_PERMISSIONS,
  query: z.object({ for: z.enum(["grid", "wizard"]).default("grid"), clientId: z.string().trim().max(64).optional() }),
  handler: async ({ db, auth, query }) => (query.for === "grid" ? await getGridOptions(db, auth.viewScope) : await getWizardOptions(db, auth.scope, query.clientId ?? null)),
});
