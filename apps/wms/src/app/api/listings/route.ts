/** `GET /api/listings?link=unlinked|linked` + grid grammar. M09. */
import { z } from 'zod';
import { LISTING_READ_PERMISSIONS } from '@/lib/grid-defs/products/permissions';
import { defineRoute } from '@/server/api/define-route';
import { listResult } from '@/server/api/envelope';
import { listListings } from '@/server/repositories/listings';
import { LISTING_LINK_STATES } from '@/lib/grid-defs/products/listings-grid';

export const GET = defineRoute({
  permission: LISTING_READ_PERMISSIONS,
  query: z.object({ link: z.enum(LISTING_LINK_STATES).optional() }).loose(),
  handler: async ({ db, auth, grid, query }) => {
    const q = grid();
    const { rows, total, counts } = await listListings(db, auth.viewScope, q, query.link);
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize, counts });
  },
});
