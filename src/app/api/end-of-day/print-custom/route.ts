/** `POST /api/end-of-day/print-custom` `{ ids }` — Custom EOD report (totals by client and service). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { printCustomReport } from "@/server/repositories/end-of-day";

export const POST = defineRoute({
  permission: "fulfillment.end_of_day.print_custom_report",
  body: z.object({ ids: z.array(z.string().trim().min(1).max(200)).min(1, "Select at least one manifest").max(200) }),
  transaction: false,
  handler: ({ db, auth, body }) => printCustomReport(db, auth, body.ids),
});
