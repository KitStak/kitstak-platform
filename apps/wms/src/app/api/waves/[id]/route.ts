/**
 * `GET /api/waves/[id]` — one wave with its result summary. The wave-rules page polls this while
 * an AI wave is Preparing For Optimization / Optimizing, then shows the final result toast.
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { notFoundError } from "@/server/api/errors";
import { hasWarehouse } from "@/server/auth/scope";
import { loadWaveRule } from "@/server/repositories/wave-rules";
import { waveById } from "@/server/repositories/waves";
import { AI_INTERIM_STATUSES, summarize } from "@/server/repositories/waves-run";

export const GET = defineRoute({
  permission: ["reports.wave_log_report.view", "automation.wave_rules.run", "automation.wave_rules.view"],
  params: z.object({ id: z.string().min(1).max(64) }),
  handler: async ({ db, auth, params }) => {
    const wave = await waveById(db, params.id);
    if (!wave || !hasWarehouse(auth.scope, wave.warehouseId)) throw notFoundError("Wave");
    const rule = wave.waveRuleId ? await loadWaveRule(db, null, wave.waveRuleId) : null;
    const op = rule?.operationType ?? "Picking";
    return {
      id: wave.id, waveNo: wave.waveNo, status: wave.status, ruleName: rule?.name ?? null, operationType: op,
      pending: (AI_INTERIM_STATUSES as readonly string[]).includes(wave.status) || wave.status === "Pending" || wave.status === "Started",
      summary: summarize(wave, op), jobsCreated: wave.jobsCreated, finishedAt: wave.finishedAt,
    };
  },
});
