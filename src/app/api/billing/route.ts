/** `GET /api/billing` — 3PL Billing contracts grid. `POST` — Create Billing Form. */
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { contractSchema } from "@/lib/grid-defs/organization/billing";
import { createContract, listContracts } from "@/server/repositories/billing";

export const GET = defineRoute({
  permission: "settings.billing.view",
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listContracts(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: "settings.billing.create",
  body: contractSchema,
  handler: ({ db, auth, actor, body }) => created(createContract(db, auth, actor, body)),
});
