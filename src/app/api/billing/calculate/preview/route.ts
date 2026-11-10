/**
 * `POST /api/billing/calculate/preview { ids, mode, start?, end? }` — the Calculate dialog's dry run.
 * Read-only by construction: this route only imports the preview function, so no stale or
 * mis-parsed flag can ever make opening the dialog write a bill.
 */
import { defineRoute } from "@/server/api/define-route";
import { calculateSchema, previewCalculation } from "@/server/repositories/billing-reports";

export const POST = defineRoute({
  permission: "settings.billing.calculate",
  body: calculateSchema,
  handler: ({ db, auth, body }) => previewCalculation(db, auth, body),
});
