/**
 * Scheduler task "billing-periods" (M11; replaces the 0.6 stub). Every hour it bills each
 * Approved 3PL billing contract whose period has closed and has no bill for it yet; a
 * failed calculation is kept as a Failed bill with its error message.
 */
import { autoCalculateDue } from "@/server/repositories/billing-reports";
import type { SchedulerTask } from "../types";

export const task: SchedulerTask = {
  key: "billing-periods",
  title: "Billing period calculation",
  owner: "M11",
  configured: true,
  schedule: { kind: "interval", everyMs: 60 * 60_000 },
  run: async ({ db, now }) => {
    const result = await autoCalculateDue(db, now);
    if (result.calculated === 0 && result.failed === 0) return { status: "skipped", message: `No closed billing periods to calculate (${result.skipped} contracts up to date)` };
    return { status: "ok", message: `${result.calculated} bills calculated${result.failed ? `, ${result.failed} failed` : ""}` };
  },
};
