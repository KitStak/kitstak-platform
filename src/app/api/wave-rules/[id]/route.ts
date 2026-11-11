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
  handler: ({ db, auth, params }) => withBusyRetry(async () => await getWaveRuleDetail(db, auth, params.id)),
});

export const PATCH = defineRoute({
  permission: "automation.wave_rules.edit",
  params: idParamsSchema,
  body: waveRuleInputSchema,
  handler: async ({ db, auth, actor, params, body }) => await withM03Actor(db, actor, auth, async () => await updateWaveRule(db, auth, domainCtx(actor, auth), params.id, body)),
});

export const DELETE = defineRoute({
  permission: "automation.wave_rules.delete",
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => await withM03Actor(db, actor, auth, async () => {
    await deleteWaveRule(db, auth, domainCtx(actor, auth), params.id);
    return { deleted: params.id };
  }),
});
