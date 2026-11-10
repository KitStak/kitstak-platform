/** `GET /api/clients` — Clients grid (grid grammar; `f.warehouseId` = Active clients for wizard selects). `POST` — 4-step Create Client. */
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { clientSchema } from "@/lib/grid-defs/organization/clients";
import { createClient, listClients } from "@/server/repositories/clients";

export const GET = defineRoute({
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listClients(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: "settings.clients.create",
  body: clientSchema,
  handler: ({ db, auth, actor, body }) => created(createClient(db, auth, actor, body)),
});
