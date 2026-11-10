/** `GET /api/wave-rules/[id]/change-log?page&ps` — field-level history of a wave rule. */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { idParamsSchema, pagingSchema } from "@/server/repositories/platform-common";
import { WAVE_RULE_ENTITY, listEntityChangeLog, loadWaveRule } from "@/server/repositories/wave-rules";

export const GET = defineRoute({
  permission: "automation.wave_rules.change_log",
  params: idParamsSchema,
  query: pagingSchema,
  handler: ({ db, auth, params, query }) => {
    loadWaveRule(db, auth, params.id);
    const { rows, total } = listEntityChangeLog(db, WAVE_RULE_ENTITY, params.id, query.page, query.ps);
    return listResult(rows, { total, page: query.page, pageSize: query.ps });
  },
});
