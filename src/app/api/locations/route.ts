import { connection } from "next/server";
import { z } from "zod";
import {
  badRequest,
  listQuerySchema,
  ok,
  queryOf,
  serverError,
  zodMessage,
} from "@/server/api-utils";
import {
  getZoneSummary,
  listLocations,
  LOCATION_TYPES,
} from "@/server/repositories/locations";

const querySchema = listQuerySchema.extend({
  zone: z.string().trim().max(20).optional(),
  type: z.enum(LOCATION_TYPES).optional(),
  view: z.enum(["list", "zones"]).default("list"),
});

export async function GET(request: Request): Promise<Response> {
  await connection();
  try {
    const parsed = querySchema.safeParse(queryOf(request));
    if (!parsed.success) return badRequest(zodMessage(parsed.error));
    const { page, pageSize, search, zone, type, view } = parsed.data;
    if (view === "zones") {
      const zones = getZoneSummary();
      return ok(zones, { total: zones.length, page: 1, pageSize: zones.length });
    }
    const { rows, total } = listLocations({ page, pageSize, search, zone, type });
    return ok(rows, { total, page, pageSize });
  } catch (error: unknown) {
    return serverError("GET /api/locations", error);
  }
}
