/**
 * `POST /api/wave-rules/run` `{ ids }` — runs the selected rules now (one wave each). Each rule
 * runs in its own savepoint, so a failing rule records a Failed wave without blocking the others.
 *
 * AI Job rules return as soon as the wave is Optimizing; the optimization (AI job grouping, route
 * sequencing, job creation) runs right after the response via `after()`, and the user is notified
 * when the wave completes. The scheduler finishes any AI wave a restart interrupted.
 */
import { after } from 'next/server';
import { z } from 'zod';
import { getAppDb } from '@/server/api/db';
import { defineRoute } from '@/server/api/define-route';
import { withM03Actor } from '@/server/repositories/jobs-actor';
import { bulkIdsSchema, domainCtx } from '@/server/repositories/platform-common';
import { loadWaveRule } from '@/server/repositories/wave-rules';
import { assertRuleRunnable, completeAiWave, runWave } from '@/server/repositories/waves-run';
import { mapSeq } from '@/server/db/sql';

export const POST = defineRoute({
  permission: 'automation.wave_rules.run',
  body: z.object({ ids: bulkIdsSchema.max(20, 'Run at most 20 rules at once') }),
  handler: async ({ db, auth, actor, body }) =>
    await withM03Actor(db, actor, auth, async () => {
      const ctx = domainCtx(actor, auth);
      const ids = [...new Set(body.ids)];
      // Check every rule first so a locked rule rejects the whole request before any wave is written.
      for (const id of ids) {
        await loadWaveRule(db, auth, id);
        await assertRuleRunnable(db, id);
      }
      const deferred: string[] = [];
      const results = await mapSeq(ids, async (id) => {
        const res = await runWave(db, ctx, id, {
          runBy: auth.user.name || auth.user.email,
          deferOptimization: (waveId) => deferred.push(waveId),
        });
        return {
          ruleId: id,
          ruleName: res.ruleName,
          waveId: res.wave.id,
          waveNo: res.wave.waveNo,
          status: res.wave.status,
          summary: res.summary,
          jobIds: res.jobIds,
        };
      });
      if (deferred.length > 0) {
        after(async () => {
          const appDb = await getAppDb();
          for (const waveId of deferred)
            await completeAiWave(appDb, ctx, waveId, { runBy: auth.user.name || auth.user.email });
        });
      }
      return { results };
    }),
});
