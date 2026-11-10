/** `GET /api/algorithms/[id]/change-log` — field-level history. */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { changeLogPageSchema, changeLogResult } from "@/server/repositories/integration-logs-kit";
import { loadAlgorithm } from "@/server/repositories/algorithms";

export const GET = defineRoute({
  permission: "automation.algorithms.change_log",
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: ({ db, auth, params, query }) => {
    loadAlgorithm(db, auth, params.id);
    return changeLogResult(db, "algorithm", params.id, query);
  },
});
