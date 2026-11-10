/** `GET /api/customers` — Customers grid (grid grammar). `POST` — create with addresses (at least one Shipping). */
import { defineRoute } from "@/server/api/define-route";
import { created, listResult } from "@/server/api/envelope";
import { customerSchema } from "@/lib/grid-defs/organization/customers";
import { createCustomer, listCustomers } from "@/server/repositories/customers";

export const GET = defineRoute({
  permission: "settings.customers.view",
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listCustomers(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: "settings.customers.create",
  body: customerSchema,
  handler: ({ db, auth, actor, body }) => created(createCustomer(db, auth, actor, body)),
});
