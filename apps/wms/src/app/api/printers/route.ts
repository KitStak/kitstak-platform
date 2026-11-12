/** `/api/printers` — per-user barcode/laser printer per warehouse in scope. */
import { defineRoute } from "@/server/api/define-route";
import { listPrinters, printerPutSchema, putPrinters } from "@/server/repositories/platform-user-prefs";

export const GET = defineRoute({
  handler: async ({ db, auth }) => await listPrinters(db, auth.user.id, auth.scope),
});

export const PUT = defineRoute({
  body: printerPutSchema,
  handler: async ({ db, auth, body }) => await putPrinters(db, auth.user.id, auth.scope, body),
});
