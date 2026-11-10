/** `POST /api/lp-numbers/labels { ids }` — `lp-label` records for Print Barcode; marks the labels printed. */
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/facility/common";
import { lpLabelRecords } from "@/server/repositories/lp-numbers";

export const POST = defineRoute({
  permission: "settings.lp_numbers.print_barcode",
  body: bulkIds,
  handler: ({ db, auth, body }) => lpLabelRecords(db, auth, body.ids),
});
