/**
 * `POST /api/reports/exports` `{ gridKey, query, columns?, timeZone? }` — Export As Excel for
 * M13 report grids whose key is not in the shared export registry yet (RA-R4-1). Same
 * contract as `POST /api/exports`: 202 with the queued `background_tasks` row; the workbook
 * is built after the response with the caller's scope and lands in the Transactions tray
 * and Excel Export History.
 */
import { after } from "next/server";
import { defineRoute } from "@/server/api/define-route";
import { result } from "@/server/api/envelope";
import { RATE_LIMITS } from "@/server/auth/rate-limit";
import { queueExportSchema, resolveExportTimeZone } from "@/server/exports";
import { log } from "@/server/log";
import { queueLocalExport, runLocalExport } from "@/server/repositories/reports-local-export";

export const POST = defineRoute({
  name: "POST /api/reports/exports",
  transaction: false,
  rateLimit: RATE_LIMITS.bulkIo,
  body: queueExportSchema,
  handler: ({ db, auth, body }) => {
    const task = queueLocalExport(db, { auth, gridKey: body.gridKey, query: body.query });
    const timeZone = resolveExportTimeZone(db, auth, body.timeZone);
    after(async () => {
      try {
        await runLocalExport(db, task.id, { auth, columns: body.columns, timeZone });
      } catch (error: unknown) {
        log.error("report export runner crashed", { taskId: task.id, err: error });
      }
    });
    return result(task, { status: 202 });
  },
});
