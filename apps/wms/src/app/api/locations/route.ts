/**
 * `GET /api/locations` — Locations grid (grid grammar: q/qm, f.*, sort, page, ps).
 *   `search=` is accepted as an alias of `q=` for integrators.
 * `POST /api/locations` — create a location with product + LP capacities.
 */
import { defineRoute } from '@/server/api/define-route';
import { AppError } from '@/server/api/errors';
import { parseGridQuery } from '@/server/query/grid-query';
import { created, listResult } from '@/server/api/envelope';
import { locationSaveSchema } from '@/lib/grid-defs/facility/locations';
import { createLocation, listLocations } from '@/server/repositories/locations';

export const GET = defineRoute({
  permission: ['settings.locations.view', 'inventory.inventory_by_location.view'],
  handler: async ({ db, auth, grid, searchParams }) => {
    const query = searchParams.has('search') && !searchParams.has('q') ? aliasSearch(searchParams) : grid();
    const { rows, total } = await listLocations(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: 'settings.locations.create',
  body: locationSaveSchema,
  handler: async ({ db, auth, actor, body }) => created(await createLocation(db, auth, actor, body)),
});

/** Re-parses the grid grammar with `search` mapped onto `q`. */
function aliasSearch(params: URLSearchParams) {
  const copy = new URLSearchParams(params);
  copy.set('q', copy.get('search') ?? '');
  copy.delete('search');
  const parsed = parseGridQuery(copy);
  const first = parsed.issues[0];
  if (first)
    throw new AppError('VALIDATION', `Invalid query: ${first.param} — ${first.message}`, {
      fieldErrors: Object.fromEntries(parsed.issues.map((i) => [i.param, [i.message]])),
    });
  return parsed.query;
}
