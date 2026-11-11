/**
 * Keys of the add-on apps (Settings → Apps) that are active for the account. Feeds the
 * shell's nav gating (`NavItem.app`) and `/api/me`.
 */
import { eq } from "drizzle-orm";
import { asc } from "@/server/db/order";
import type { AppDb } from "@/server/api/db";
import { apps } from "@/server/db/schema";

export async function listActiveAppKeys(db: AppDb): Promise<string[]> {
  return (await db.select({ key: apps.key }).from(apps).where(eq(apps.isActive, true)).orderBy(asc(apps.key))).map((r) => r.key);
}
