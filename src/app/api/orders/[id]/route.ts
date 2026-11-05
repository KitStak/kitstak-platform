import { notFound, ok, requireSession, serverError } from "@/server/api-utils";
import { getOrderDetail } from "@/server/repositories/orders";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const denied = await requireSession();
    if (denied) return denied;
    const { id } = await context.params;
    const detail = getOrderDetail(id);
    if (!detail) return notFound("Order not found");
    return ok(detail);
  } catch (error: unknown) {
    return serverError("GET /api/orders/[id]", error);
  }
}
