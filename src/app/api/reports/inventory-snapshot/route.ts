import { z } from "zod";
import {
  badRequest,
  listQuerySchema,
  ok,
  queryOf,
  serverError,
  zodMessage,
} from "@/server/api-utils";
import { getInventorySnapshot } from "@/server/repositories/reports";

const querySchema = listQuerySchema.extend({
  clientId: z.string().trim().max(60).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const parsed = querySchema.safeParse(queryOf(request));
    if (!parsed.success) return badRequest(zodMessage(parsed.error));
    const { page, pageSize, search, clientId } = parsed.data;
    const { rows, total } = getInventorySnapshot({ page, pageSize, search, clientId });
    return ok(rows, { total, page, pageSize });
  } catch (error: unknown) {
    return serverError("GET /api/reports/inventory-snapshot", error);
  }
}
