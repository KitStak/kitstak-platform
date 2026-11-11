/**
 * `GET /api/printouts` — per-type template grid (grid grammar; `?typeKey=`), or, with
 * `?typeKeys=a,b&clientId=`, the print-modal template list (active templates the client may use).
 * `POST` — create a printout from the 5-step wizard. The grid needs `settings.printouts_labels.view` (403 otherwise).
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { forbiddenError } from "@/server/api/errors";
import { printoutSchema } from "@/lib/grid-defs/admin/printouts";
import { createPrintout, listPrintouts, printTemplatesFor } from "@/server/repositories/printouts";
import { listParam } from "@/server/repositories/users-shared";

const query = z.object({
  typeKey: z.string().trim().max(80).optional(),
  typeKeys: z.string().trim().max(2000).optional(),
  clientId: z.string().trim().max(64).optional(),
}).passthrough();

export const GET = defineRoute({
  query,
  handler: async ({ db, auth, query: q, grid }) => {
    if (q.typeKeys !== undefined) return await printTemplatesFor(db, listParam(q.typeKeys), q.clientId ?? null);
    // The template grid is admin metadata: same gate as the /settings/printouts page. The
    // `typeKeys` branch above stays open to print callers (active template names only).
    if (!auth.permissions.has("settings.printouts_labels.view")) throw forbiddenError("You don't have permission to view printout templates");
    const gq = grid();
    const { rows, total } = await listPrintouts(db, gq, q.typeKey);
    return listResult(rows, { total, page: gq.page, pageSize: gq.pageSize });
  },
});

export const POST = defineRoute({
  permission: "settings.printouts_labels.create",
  body: printoutSchema,
  handler: async ({ db, auth, actor, body, audit }) => {
    const row = await createPrintout(db, auth, actor, body);
    await audit({ action: "printout.create", entity: "printout", entityId: row.id, detail: { name: row.name, type: body.typeKey } });
    return created(row);
  },
});
