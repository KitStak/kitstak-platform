/**
 * Scheduler task "eod-auto-close" (owner M02). Every minute: for each active End of the Day auto-close rule
 * whose cutoff (warehouse local time) has passed today, closes that carrier setup's Open manifests dated
 * today or earlier and prints the report, once per warehouse-local day.
 */
import { runAutoClose } from "@/server/repositories/shipping-carrier-ops";
import type { SchedulerTask, TaskResult } from "../types";

export const task: SchedulerTask = {
  key: "eod-auto-close",
  title: "End of the day auto-close",
  owner: "M02",
  configured: true,
  schedule: { kind: "interval", everyMs: 60_000 },
  run: async ({ db, now }): Promise<TaskResult> => {
    const r = await runAutoClose(db, now);
    return r.rules === 0 ? { status: "skipped", message: "No auto-close rule is due" } : { status: "ok", message: `${r.rules} rule(s) ran, ${r.closed} manifest(s) closed` };
  },
};
