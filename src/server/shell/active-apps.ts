/**
 * Keys of the add-on apps (Settings → Apps) that are active for the account. Feeds the
 * shell's nav gating (`NavItem.app`) and `/api/me`.
 */
import { asc, eq } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { apps } from "@/server/db/schema";

export function listActiveAppKeys(db: AppDb): string[] {
  return db.select({ key: apps.key }).from(apps).where(eq(apps.isActive, true)).orderBy(asc(apps.key)).all().map((r) => r.key);
}
