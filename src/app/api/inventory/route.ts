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
  listAtp,
  listInventoryByLocation,
  listTotalInventory,
} from "@/server/repositories/inventory";

const querySchema = listQuerySchema.extend({
  view: z.enum(["total", "by-location", "atp"]).default("total"),
  clientId: z.string().trim().max(60).optional(),
  zone: z.string().trim().max(20).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const parsed = querySchema.safeParse(queryOf(request));
    if (!parsed.success) return badRequest(zodMessage(parsed.error));
    const { page, pageSize, search, view, clientId, zone } = parsed.data;
    const params = { page, pageSize, search, clientId, zone };
    const { rows, total } =
      view === "by-location"
        ? listInventoryByLocation(params)
        : view === "atp"
          ? listAtp(params)
          : listTotalInventory(params);
    return ok(rows, { total, page, pageSize });
  } catch (error: unknown) {
    return serverError("GET /api/inventory", error);
  }
}
