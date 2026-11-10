/** `GET /api/company/lookups/counts` — value counts per lookup type for the Data Setup nav. */
import { defineRoute } from "@/server/api/define-route";
import { lookupCounts } from "@/server/repositories/company-lookups";
import { DATA_SETUP_PERMISSION } from "../shared";

export const GET = defineRoute({
  permission: DATA_SETUP_PERMISSION,
  handler: ({ db, auth }) => lookupCounts(db, auth),
});
