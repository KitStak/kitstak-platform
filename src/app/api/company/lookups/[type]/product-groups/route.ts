/**
 * `GET /api/company/lookups/location_zone/product-groups` — zones with their product groups plus
 * the product group options; `PUT` `{ assignments: [{ zoneId, productGroupIds }] }` saves them.
 * Only the Location Zone lookup supports this (404 for other types).
 */
import { defineRoute } from "@/server/api/define-route";
import { AppError } from "@/server/api/errors";
import { zoneGroupsSchema } from "@/lib/grid-defs/admin/lookups";
import { setZoneProductGroups, zoneProductGroups } from "@/server/repositories/company-zone-groups";
import { DATA_SETUP_PERMISSION, typeParams } from "../../shared";

function assertZone(type: string): void {
  if (type !== "location_zone") throw new AppError("NOT_FOUND", "Only location zones match with product groups");
}

export const GET = defineRoute({
  permission: DATA_SETUP_PERMISSION,
  params: typeParams,
  handler: async ({ db, auth, params }) => { assertZone(params.type); return await zoneProductGroups(db, auth); },
});

export const PUT = defineRoute({
  permission: DATA_SETUP_PERMISSION,
  params: typeParams,
  body: zoneGroupsSchema,
  handler: async ({ db, auth, actor, params, body, audit }) => {
    assertZone(params.type);
    const result = await setZoneProductGroups(db, auth, actor, body);
    await audit({ action: "lookup.zone_product_groups", entity: "lookup", entityId: "location_zone", detail: { zones: body.assignments.length, updated: result.updated } });
    return result;
  },
});
