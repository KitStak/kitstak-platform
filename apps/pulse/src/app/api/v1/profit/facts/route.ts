import { apiRoute, withMeta } from '@/server/http/api';
import { intParam, listOf, oneOf, rangeParams, uuidParam } from '@/server/http/params';
import { FACTS_PAGE_DEFAULT, FACTS_PAGE_MAX, listFactsPage } from '@/server/domain';
import { FACT_KINDS, JOB_STATUS_VALUES } from '@/lib/constants';

/**
 * The stamped rows behind a number (drill down), newest first. `?kinds=labor,material&limit=&offset=`
 * plus the Profit filters. `data` is the page; `meta` is `{ truncated, limit, offset, nextOffset }`.
 * When `truncated` is true, ask again with `offset=nextOffset`: a total over one page alone would
 * come up short.
 */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const page = await listFactsPage(ctx, {
    ...rangeParams(searchParams),
    siteId: uuidParam(searchParams, 'site'),
    clientId: uuidParam(searchParams, 'client'),
    jobTypeId: uuidParam(searchParams, 'jobType'),
    jobId: uuidParam(searchParams, 'job'),
    vasServiceId: uuidParam(searchParams, 'service'),
    status: oneOf(searchParams, 'status', JOB_STATUS_VALUES),
    kinds: listOf(searchParams, 'kinds', FACT_KINDS),
    limit: intParam(searchParams, 'limit', FACTS_PAGE_DEFAULT, FACTS_PAGE_MAX),
    offset: intParam(searchParams, 'offset', 0, 10_000_000),
  });
  return withMeta(page.rows, { truncated: page.truncated, limit: page.limit, offset: page.offset, nextOffset: page.nextOffset });
});
