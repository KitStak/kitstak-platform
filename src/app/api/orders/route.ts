import { z } from "zod";
import {
  badRequest,
  listQuerySchema,
  ok,
  queryOf,
  serverError,
  zodMessage,
} from "@/server/api-utils";
import { listOrders, ORDER_CHANNELS, ORDER_STATUSES } from "@/server/repositories/orders";

const querySchema = listQuerySchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  channel: z.enum(ORDER_CHANNELS).optional(),
  clientId: z.string().trim().max(60).optional(),
  tab: z.enum(["backlog", "shipped", "returns"]).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const parsed = querySchema.safeParse(queryOf(request));
    if (!parsed.success) return badRequest(zodMessage(parsed.error));
    const { page, pageSize, search, status, channel, clientId, tab } = parsed.data;
    const { rows, total } = listOrders({ page, pageSize, search, status, channel, clientId, tab });
    return ok(rows, { total, page, pageSize });
  } catch (error: unknown) {
    return serverError("GET /api/orders", error);
  }
}
