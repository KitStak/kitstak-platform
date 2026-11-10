/** Hospital locations page helpers (PURE, unit tested). */

export interface HospitalWarehouseSummary {
  readonly warehouseId: string;
  readonly hospitals: number;
  readonly units: number;
}

/**
 * Default warehouse for the hospital page, the same preference order as the Packing and Return
 * Station dashboards (URL → remembered packing → remembered returns → header context → user default),
 * but a preferred warehouse without any hospital loses to the first one that has hospitals
 * (the most units first), so the page never opens on an empty warehouse when another has stock.
 */
export function pickHospitalWarehouse(
  warehouses: readonly { readonly id: string }[],
  preferred: readonly (string | null | undefined)[],
  summary: readonly HospitalWarehouseSummary[] | null,
): string | null {
  const valid = preferred.filter((id): id is string => Boolean(id) && warehouses.some((w) => w.id === id));
  if (!summary) return valid[0] ?? warehouses[0]?.id ?? null;
  const has = (id: string) => (summary.find((s) => s.warehouseId === id)?.hospitals ?? 0) > 0;
  const hit = valid.find(has);
  if (hit) return hit;
  const best = [...summary].filter((s) => s.hospitals > 0 && warehouses.some((w) => w.id === s.warehouseId))
    .sort((a, b) => b.units - a.units || b.hospitals - a.hospitals)[0];
  return best?.warehouseId ?? valid[0] ?? warehouses[0]?.id ?? null;
}

/** Why Move back is disabled for a hospital stock row (null = enabled). */
export function moveBackDisabledReason(row: { readonly free: number; readonly orders: readonly { readonly code: string; readonly packShortStatus: string | null }[] }, canMove: boolean): string | null {
  if (!canMove) return "You need the Execute Task permission to move stock";
  if (row.free > 0) return null;
  const codes = row.orders.map((o) => `${o.code}${o.packShortStatus === "Open" ? " (pack short)" : ""}`);
  if (codes.length === 0) return "No free units to move";
  return `All units are held for ${codes.join(", ")}. Resolve the pack short on the order first.`;
}
