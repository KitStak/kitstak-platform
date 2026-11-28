/** GET /api/v1/export/people.csv (SPEC 7 and 8.8): the People file for the reader's filters and sight. */
import { exportPeopleCsv } from '@/server/domain/exports';
import { csvRoute } from '@/server/http/api';
import { PERSON_KINDS, PERSON_STATUSES, type PersonKind, type PersonStatus } from '@/lib/csv/people';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (value: string | null): string | null => (value && UUID.test(value) ? value : null);

export const GET = csvRoute(async ({ ctx, searchParams }) => {
  const kind = searchParams.get('kind');
  const status = searchParams.get('status');
  return exportPeopleCsv(ctx, {
    q: searchParams.get('q'),
    siteId: uuidOrNull(searchParams.get('site')),
    agencyId: uuidOrNull(searchParams.get('agency')),
    laborClassId: uuidOrNull(searchParams.get('class')),
    kind: kind && (PERSON_KINDS as readonly string[]).includes(kind) ? (kind as PersonKind) : null,
    status: status === 'all' ? 'all' : status && (PERSON_STATUSES as readonly string[]).includes(status) ? (status as PersonStatus) : 'current',
  });
});
