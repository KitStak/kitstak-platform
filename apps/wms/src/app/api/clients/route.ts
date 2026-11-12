/**
 * `GET /api/clients` — Clients grid (grid grammar; `f.warehouseId` = Active clients for wizard selects).
 * Callers without `settings.clients.view` (operators, viewers using client pickers) get a slim
 * option payload: id, code, names, status and currency only (no tax ID, contacts, plan or KPIs).
 * The repository never selects PII for them; the route whitelists the keys again as a last guard.
 * `POST` — 4-step Create Client.
 */
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { clientSchema } from "@/lib/grid-defs/organization/clients";
import { createClient, listClientsForCaller, SLIM_CLIENT_KEYS } from "@/server/repositories/clients";

const pickSlim = (row: object): Record<string, unknown> =>
  Object.fromEntries(SLIM_CLIENT_KEYS.map((k) => [k, (row as Record<string, unknown>)[k] ?? null]));

export const GET = defineRoute({
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = await listClientsForCaller(db, auth, query);
    const safe = auth.permissions.has("settings.clients.view") ? (rows as readonly object[] as readonly Record<string, unknown>[]) : rows.map(pickSlim);
    return listResult(safe, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: "settings.clients.create",
  body: clientSchema,
  handler: async ({ db, auth, actor, body }) => created(await createClient(db, auth, actor, body)),
});
