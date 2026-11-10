/**
 * `POST /api/wave-rules/run` `{ ids }` — runs the selected rules now (one wave each). Each rule
 * runs in its own savepoint, so a failing rule records a Failed wave without blocking the others.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { bulkIdsSchema, domainCtx } from "@/server/repositories/platform-common";
import { loadWaveRule } from "@/server/repositories/wave-rules";
import { runWave } from "@/server/repositories/waves-run";

export const POST = defineRoute({
  permission: "automation.wave_rules.run",
  body: z.object({ ids: bulkIdsSchema.max(20, "Run at most 20 rules at once") }),
  handler: ({ db, auth, actor, body }) => {
    const ctx = domainCtx(actor, auth);
    const results = body.ids.map((id) => {
      loadWaveRule(db, auth, id);
      const res = runWave(db, ctx, id, { runBy: auth.user.name });
      return { ruleId: id, ruleName: res.ruleName, waveId: res.wave.id, waveNo: res.wave.waveNo, status: res.wave.status, summary: res.summary, jobIds: res.jobIds };
    });
    return { results };
  },
});
