/** `GET /api/products/components?clientId=&q=&excludeId=` — kit component search (client-scoped). M09. */
import { defineRoute } from "@/server/api/define-route";
import { componentSearchSchema, searchComponents } from "@/server/repositories/products-options";

export const GET = defineRoute({
  permission: ["settings.products.create", "settings.products.edit"],
  query: componentSearchSchema,
  handler: ({ db, auth, query }) => searchComponents(db, auth.scope, query),
});
