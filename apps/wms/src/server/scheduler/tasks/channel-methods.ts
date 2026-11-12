/**
 * Scheduler task "channel-methods" (M12; replaces the 0.6 stub). Every minute it runs the channel
 * methods whose next run is due (Download Orders · Download Products · Sync Inventory · Send
 * Shipment Info) for active, runnable store connections; others are marked Paused.
 */
import "@/server/integrations/carriers";
import { runDueChannelMethods } from "@/server/integrations/runtime/channel-runtime";
import type { SchedulerTask } from "../types";

export const task: SchedulerTask = {
  key: "channel-methods",
  title: "Channel integration methods",
  owner: "M12",
  configured: true,
  schedule: { kind: "interval", everyMs: 60_000 },
  run: async ({ db, now }) => {
    const result = await runDueChannelMethods(db, now);
    return { status: result.ran > 0 ? "ok" : "skipped", message: `${result.ran} method run(s), ${result.skipped} paused` };
  },
};
