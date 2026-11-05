import { connection } from "next/server";
import { z } from "zod";
import {
  badRequest,
  listQuerySchema,
  ok,
  queryOf,
  requireSession,
  serverError,
  zodMessage,
} from "@/server/api-utils";
import { getInventorySnapshot } from "@/server/repositories/reports";

const querySchema = listQuerySchema.extend({
  clientId: z.string().trim().max(60).optional(),
});

export async function GET(request: Request): Promise<Response> {
  await connection();
  try {
    const denied = await requireSession();
    if (denied) return denied;
    const parsed = querySchema.safeParse(queryOf(request));
    if (!parsed.success) return badRequest(zodMessage(parsed.error));
    const { page, pageSize, search, clientId } = parsed.data;
    const { rows, total } = getInventorySnapshot({ page, pageSize, search, clientId });
    return ok(rows, { total, page, pageSize });
  } catch (error: unknown) {
    return serverError("GET /api/reports/inventory-snapshot", error);
  }
}
