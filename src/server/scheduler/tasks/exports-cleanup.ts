/**
 * Export / printout file cleanup (BUILD_PLAN F6): hourly, deletes files past their
 * `expires_at` (exports and printouts keep 7 days) and fails exports left queued/started
 * by a restart so the Transactions tray never spins forever.
 */
import { failStaleExports } from "@/server/exports/runner";
import { fileStore, type FileStore } from "@/server/files/files";
import type { SchedulerTask, SchedulerTaskContext, TaskResult } from "../types";

export const STALE_EXPORT_MS = 60 * 60 * 1000;

export async function runExportsCleanup(ctx: SchedulerTaskContext, store: FileStore = fileStore()): Promise<TaskResult> {
  const deleted = await store.deleteExpired(ctx.db);
  const stale = await failStaleExports(ctx.db, new Date(ctx.now.getTime() - STALE_EXPORT_MS), ctx.now);
  if (deleted === 0 && stale === 0) return { status: "skipped", message: "Nothing to clean up" };
  return { status: "ok", message: `Deleted ${deleted} expired files; failed ${stale} interrupted exports` };
}

export const exportsCleanupTask: SchedulerTask = {
  key: "exports-cleanup",
  title: "Export file cleanup",
  owner: "foundation",
  configured: true,
  schedule: { kind: "interval", everyMs: 60 * 60 * 1000 },
  run: async (ctx) => await runExportsCleanup(ctx),
};
