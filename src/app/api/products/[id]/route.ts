import { notFound, ok, serverError } from "@/server/api-utils";
import { getProductDetail } from "@/server/repositories/products";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const detail = getProductDetail(id);
    if (!detail) return notFound("Product not found");
    return ok(detail);
  } catch (error: unknown) {
    return serverError("GET /api/products/[id]", error);
  }
}
