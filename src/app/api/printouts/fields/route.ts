/** `GET /api/printouts/fields?typeKey=` — bindable fields for designer blocks (built-in + custom fields). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { BINDABLE_FIELDS } from "@/lib/grid-defs/admin/printouts";
import { printoutCustomFields } from "@/server/repositories/printouts";

export const GET = defineRoute({
  permission: "settings.printouts_labels.view",
  query: z.object({ typeKey: z.string().min(1).max(80) }),
  handler: async ({ db, query }) => ({ builtIn: BINDABLE_FIELDS, custom: await printoutCustomFields(db, query.typeKey) }),
});
