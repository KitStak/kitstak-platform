import { connection } from "next/server";
import { z } from "zod";
import {
  badRequest,
  listQuerySchema,
  ok,
  queryOf,
  requireRole,
  serverError,
  zodMessage,
} from "@/server/api-utils";
import { listAuditLog } from "@/server/repositories/audit";

const querySchema = listQuerySchema.extend({
  entity: z.string().trim().max(60).optional(),
});

export async function GET(request: Request): Promise<Response> {
  await connection();
  try {
    const denied = await requireRole(["admin", "manager"]);
    if (denied) return denied;
    const parsed = querySchema.safeParse(queryOf(request));
    if (!parsed.success) return badRequest(zodMessage(parsed.error));
    const { page, pageSize, search, entity } = parsed.data;
    const { rows, total } = listAuditLog({ page, pageSize, search, entity });
    return ok(rows, { total, page, pageSize });
  } catch (error: unknown) {
    return serverError("GET /api/audit", error);
  }
}
