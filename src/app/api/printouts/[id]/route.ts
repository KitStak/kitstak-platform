/** `GET|PATCH|DELETE /api/printouts/[id]` — detail, edit (optimistic `version`), delete (default protected). */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { printoutSchema } from "@/lib/grid-defs/admin/printouts";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { deletePrintouts, getPrintout, updatePrintout } from "@/server/repositories/printouts";

export const GET = defineRoute({
  permission: "settings.printouts_labels.view",
  params: idParamsSchema,
  handler: ({ db, params }) => getPrintout(db, params.id),
});

export const PATCH = defineRoute({
  permission: "settings.printouts_labels.edit",
  params: idParamsSchema,
  body: printoutSchema,
  handler: ({ db, auth, actor, params, body }) => updatePrintout(db, auth, actor, params.id, body),
});

export const DELETE = defineRoute({
  permission: "settings.printouts_labels.delete",
  params: idParamsSchema,
  handler: ({ db, auth, actor, params }) => {
    const result = deletePrintouts(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure) throw new AppError(failure.code === "NOT_FOUND" ? "NOT_FOUND" : "INVALID_STATE", failure.message);
    return result;
  },
});
