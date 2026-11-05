import { z } from "zod";
import {
  badRequest,
  listQuerySchema,
  ok,
  queryOf,
  serverError,
  zodMessage,
} from "@/server/api-utils";
import { listClients } from "@/server/repositories/clients";

const querySchema = listQuerySchema.extend({
  status: z.enum(["Active", "Inactive"]).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const parsed = querySchema.safeParse(queryOf(request));
    if (!parsed.success) return badRequest(zodMessage(parsed.error));
    const { page, pageSize, search, status } = parsed.data;
    const { rows, total } = listClients({ page, pageSize, search, status });
    return ok(rows, { total, page, pageSize });
  } catch (error: unknown) {
    return serverError("GET /api/clients", error);
  }
}
