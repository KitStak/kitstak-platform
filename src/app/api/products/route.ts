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
import { listProducts, PRODUCT_CATEGORIES } from "@/server/repositories/products";

const querySchema = listQuerySchema.extend({
  clientId: z.string().trim().max(60).optional(),
  category: z.enum(PRODUCT_CATEGORIES).optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
});

export async function GET(request: Request): Promise<Response> {
  await connection();
  try {
    const parsed = querySchema.safeParse(queryOf(request));
    if (!parsed.success) return badRequest(zodMessage(parsed.error));
    const { page, pageSize, search, clientId, category, status } = parsed.data;
    const { rows, total } = listProducts({ page, pageSize, search, clientId, category, status });
    return ok(rows, { total, page, pageSize });
  } catch (error: unknown) {
    return serverError("GET /api/products", error);
  }
}
