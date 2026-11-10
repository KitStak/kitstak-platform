/** `GET /api/printouts/[id]/change-log` — Printout Change Log. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { loadPrintout, PRINTOUT_ENTITY } from "@/server/repositories/printouts";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/users-shared";

export const GET = defineRoute({
  permission: ["settings.printouts_labels.change_log", "settings.printouts_labels.view"],
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: ({ db, params, query }) => {
    loadPrintout(db, params.id);
    return changeLogResult(db, PRINTOUT_ENTITY, params.id, query);
  },
});
