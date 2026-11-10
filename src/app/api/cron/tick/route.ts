/**
 * `POST /api/cron/tick` — external scheduler trigger, `Authorization: Bearer <CRON_SECRET>`.
 * 503 when CRON_SECRET is not configured, 401 on a wrong token; otherwise runs one tick.
 */
import { NextResponse } from "next/server";
import { defineRoute } from "@/server/api/define-route";
import { unauthenticatedError } from "@/server/api/errors";
import { runSchedulerTick, verifyCronAuthorization } from "@/server/scheduler";

export const POST = defineRoute({
  auth: "public",
  csrf: false,
  rateLimit: false,
  transaction: false,
  handler: async ({ request, requestId }) => {
    const check = verifyCronAuthorization(request.headers.get("authorization"));
    if (check === "not_configured") {
      return NextResponse.json(
        { success: false, error: "The cron endpoint is not configured (set CRON_SECRET).", code: "INVALID_STATE", requestId },
        { status: 503, headers: { "x-request-id": requestId } },
      );
    }
    if (check !== "ok") throw unauthenticatedError("Invalid cron token");
    return runSchedulerTick();
  },
});
