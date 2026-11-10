/**
 * `POST /api/exports` `{ gridKey, query, columns? }` — queues an "Export As Excel" run
 * (background_tasks kind=export, 202). The workbook is built after the response through
 * the grid's export provider; the list is read as the caller (same cookie, same scope).
 */
import { after } from "next/server";
import { defineRoute } from "@/server/api/define-route";
import { RATE_LIMITS } from "@/server/auth/rate-limit";
import { result } from "@/server/api/envelope";
import { createHttpListFetcher, queueExport, queueExportSchema, resolveExportTimeZone, runExport } from "@/server/exports";
import { log } from "@/server/log";

export const POST = defineRoute({
  transaction: false,
  rateLimit: RATE_LIMITS.bulkIo,
  body: queueExportSchema,
  handler: ({ db, auth, body, request }) => {
    const task = queueExport(db, { auth, gridKey: body.gridKey, query: body.query });
    const listFetcher = createHttpListFetcher({ origin: request.nextUrl.origin, cookie: request.headers.get("cookie") });
    const timeZone = resolveExportTimeZone(db, auth, body.timeZone);
    after(async () => {
      try {
        await runExport(db, task.id, { auth, listFetcher, columns: body.columns, timeZone });
      } catch (error: unknown) {
        log.error("export runner crashed", { taskId: task.id, err: error });
      }
    });
    return result(task, { status: 202 });
  },
});
