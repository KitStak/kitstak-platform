/** `POST /api/customers/bulk-delete { ids }` — per-id result; customers with orders are skipped. */
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/organization/common";
import { deleteCustomers } from "@/server/repositories/customers";

export const POST = defineRoute({
  permission: "settings.customers.delete",
  body: bulkIds,
  handler: ({ db, auth, actor, body }) => deleteCustomers(db, auth, actor, body.ids),
});
