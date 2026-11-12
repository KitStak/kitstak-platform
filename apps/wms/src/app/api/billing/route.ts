/** `GET /api/billing` — 3PL Billing contracts grid. `POST` — Create Billing Form. */
import { defineRoute } from '@/server/api/define-route';
import { created, listResult } from '@/server/api/envelope';
import { contractSchema } from '@/lib/grid-defs/organization/billing';
import { createContract, getContract, listContracts } from '@/server/repositories/billing';

export const GET = defineRoute({
  permission: 'settings.billing.view',
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = await listContracts(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: 'settings.billing.create',
  body: contractSchema,
  // Returns the full detail so /billing/[id] renders instantly from the seeded cache.
  handler: async ({ db, auth, actor, body }) => {
    const row = await createContract(db, auth, actor, body);
    return created({ ...(await getContract(db, auth, row.id)), id: row.id, name: row.name });
  },
});
