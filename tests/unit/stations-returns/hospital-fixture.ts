/** Test helper: a designated hospital location (code HOSP-01) in the world's warehouse, created once. */
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { locationRow, type World } from "../foundation/domain/fixtures";

export function hospitalOf(w: World, code = "HOSP-01", extra: Partial<typeof schema.locations.$inferInsert> = {}): string {
  const found = w.db.select({ id: schema.locations.id }).from(schema.locations).where(and(eq(schema.locations.warehouseId, w.warehouseId), eq(schema.locations.code, code))).get();
  if (found) return found.id;
  return w.db.insert(schema.locations).values(locationRow(w.warehouseId, code, { type: "Damaged", areaType: "Storage", locationType: "Shelves", preventAllocation: true, ...extra })).returning().get().id;
}
