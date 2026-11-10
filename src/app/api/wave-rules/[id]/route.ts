/** `GET|PATCH|DELETE /api/wave-rules/[id]` — detail, edit (version-checked) and soft delete. */
import { withBusyRetry } from "@/server/repositories/jobs-read-retry";
import { defineRoute } from "@/server/api/define-route";
import { withM03Actor } from "@/server/repositories/jobs-actor";
import { waveRuleInputSchema } from "@/lib/grid-defs/jobs/forms";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";
import { deleteWaveRule, getWaveRuleDetail, updateWaveRule } from "@/server/repositories/wave-rules";

export const GET = defineRoute({
  permission: "automation.wave_rules.view",
  params: idParamsSchema,
  handler: ({ db, auth, params }) => withBusyRetry(() => getWaveRuleDetail(db, auth, params.id)),
});

export const PATCH = defineRoute({
  permission: "automation.wave_rules.edit",
  params: idParamsSchema,
  body: waveRuleInputSchema,
  handler: ({ db, auth, actor, params, body }) => withM03Actor(db, actor, auth, () => updateWaveRule(db, auth, domainCtx(actor, auth), params.id, body)),
});

export const DELETE = defineRoute({
  permission: "automation.wave_rules.delete",
  params: idParamsSchema,
  handler: ({ db, auth, actor, params }) => withM03Actor(db, actor, auth, () => {
    deleteWaveRule(db, auth, domainCtx(actor, auth), params.id);
    return { deleted: params.id };
  }),
});
