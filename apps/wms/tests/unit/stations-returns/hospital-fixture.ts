/** Test helper: a designated hospital location (code HOSP-01) in the world's warehouse, created once. */
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { locationRow, type World } from "../foundation/domain/fixtures";

export async function hospitalOf(w: World, code = "HOSP-01", extra: Partial<typeof schema.locations.$inferInsert> = {}): Promise<string> {
  const found = (await w.db.select({ id: schema.locations.id }).from(schema.locations).where(and(eq(schema.locations.warehouseId, w.warehouseId), eq(schema.locations.code, code))).limit(1))[0];
  if (found) return found.id;
  return (await w.db.insert(schema.locations).values(locationRow(w.warehouseId, code, { type: "Damaged", areaType: "Storage", locationType: "Shelves", preventAllocation: true, ...extra })).returning())[0].id;
}
