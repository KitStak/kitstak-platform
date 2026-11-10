/**
 * `POST /api/lp-numbers/bulk-delete { ids }` — per-id result. Never-used Empty LPs are deleted,
 * Empty LPs with history are voided (status Removed), LPs with stock / a parent / children or
 * that have shipped are refused with the reason. `deleted` / `voided` list which happened.
 * Gated by Edit: Logiwa's LP Numbers page has no separate Delete permission (REQ-R6-2 asks for one).
 */
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/facility/common";
import { removeLpNumbers } from "@/server/repositories/lp-numbers";

export const POST = defineRoute({
  permission: "settings.lp_numbers.delete",
  body: bulkIds,
  handler: ({ db, auth, actor, body }) => removeLpNumbers(db, auth, actor, body.ids),
});
