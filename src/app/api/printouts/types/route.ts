/** `GET /api/printouts/types` — the 25 printout types with template counts and category. */
import { defineRoute } from "@/server/api/define-route";
import { printoutTypes } from "@/server/repositories/printouts";

export const GET = defineRoute({
  permission: "settings.printouts_labels.view",
  handler: async ({ db }) => await printoutTypes(db),
});
