/** `GET /api/wave-rules` (grid) · `POST /api/wave-rules` (create from the wizard). */
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { waveRuleInputSchema } from "@/lib/grid-defs/jobs/forms";
import { domainCtx } from "@/server/repositories/platform-common";
import { createWaveRule, listWaveRules } from "@/server/repositories/wave-rules";

export const GET = defineRoute({
  permission: "automation.wave_rules.view",
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listWaveRules(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: "automation.wave_rules.create",
  body: waveRuleInputSchema,
  handler: ({ db, auth, actor, body }) => created(createWaveRule(db, auth, domainCtx(actor, auth), body)),
});
