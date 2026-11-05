import { notFound, ok, serverError } from "@/server/api-utils";
import { getPurchaseOrderDetail } from "@/server/repositories/purchase-orders";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const detail = getPurchaseOrderDetail(id);
    if (!detail) return notFound("Purchase order not found");
    return ok(detail);
  } catch (error: unknown) {
    return serverError("GET /api/purchase-orders/[id]", error);
  }
}
