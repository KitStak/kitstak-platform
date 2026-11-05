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
import { listPurchaseOrders, PO_STATUSES } from "@/server/repositories/purchase-orders";

const querySchema = listQuerySchema.extend({
  status: z.enum(PO_STATUSES).optional(),
  clientId: z.string().trim().max(60).optional(),
});

export async function GET(request: Request): Promise<Response> {
  await connection();
  try {
    const parsed = querySchema.safeParse(queryOf(request));
    if (!parsed.success) return badRequest(zodMessage(parsed.error));
    const { page, pageSize, search, status, clientId } = parsed.data;
    const { rows, total } = listPurchaseOrders({ page, pageSize, search, status, clientId });
    return ok(rows, { total, page, pageSize });
  } catch (error: unknown) {
    return serverError("GET /api/purchase-orders", error);
  }
}
