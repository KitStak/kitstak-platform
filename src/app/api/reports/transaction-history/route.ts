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
import { getTransactionHistory } from "@/server/repositories/reports";

const querySchema = listQuerySchema.extend({
  type: z.enum(["Shipment", "Receipt"]).optional(),
});

export async function GET(request: Request): Promise<Response> {
  await connection();
  try {
    const denied = await requireSession();
    if (denied) return denied;
    const parsed = querySchema.safeParse(queryOf(request));
    if (!parsed.success) return badRequest(zodMessage(parsed.error));
    const { page, pageSize, search, type } = parsed.data;
    const { rows, total } = getTransactionHistory({ page, pageSize, search, type });
    return ok(rows, { total, page, pageSize });
  } catch (error: unknown) {
    return serverError("GET /api/reports/transaction-history", error);
  }
}
