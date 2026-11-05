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
import { listUsers, USER_ROLES } from "@/server/repositories/users";

const querySchema = listQuerySchema.extend({
  role: z.enum(USER_ROLES).optional(),
});

export async function GET(request: Request): Promise<Response> {
  await connection();
  try {
    const parsed = querySchema.safeParse(queryOf(request));
    if (!parsed.success) return badRequest(zodMessage(parsed.error));
    const { page, pageSize, search, role } = parsed.data;
    const { rows, total } = listUsers({ page, pageSize, search, role });
    return ok(rows, { total, page, pageSize });
  } catch (error: unknown) {
    return serverError("GET /api/users", error);
  }
}
