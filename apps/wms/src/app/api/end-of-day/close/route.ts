/** `POST /api/end-of-day/close` `{ ids }` — Print End of the Day Report: closes the manifests and returns the PDF file id. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { closeManifests } from "@/server/repositories/end-of-day";
import { domainCtx } from "@/server/repositories/platform-common";

export const POST = defineRoute({
  permission: "fulfillment.end_of_day.print_end_of_the_day_report",
  body: z.object({ ids: z.array(z.string().trim().min(1).max(200)).min(1, "Select at least one manifest").max(200) }),
  transaction: false,
  handler: ({ db, auth, actor, body }) => closeManifests(db, auth, domainCtx(actor, auth), body.ids),
});
