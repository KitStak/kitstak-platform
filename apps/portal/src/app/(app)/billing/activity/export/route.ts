/**
 * The billing activity as a CSV file. The same rule as the page: a signed in owner, admin or billing
 * manager of the active organization, and only that organization's rows. Nobody else gets a byte.
 */
import { getBillingContext } from '@/server/billing/context';
import { csvCell, isActivityFilter, kindOf, type ActivityFilter } from '@/features/billing-activity/model';
import { listActivity } from '@/features/billing-activity/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ROWS = 5000;
const KIND_WORDS = { payments: 'Payment', plan: 'Plan change', emails: 'Email' } as const;

export async function GET(request: Request): Promise<Response> {
  const context = await getBillingContext();
  if (!context || !context.access.canView) {
    return new Response('Not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const wanted = new URL(request.url).searchParams.get('show') ?? undefined;
  const filter: ActivityFilter = isActivityFilter(wanted) ? wanted : 'all';
  const rows = await listActivity({ orgId: context.org.id, filter, limit: MAX_ROWS });

  const lines = [['When (UTC)', 'Kind', 'Who', 'What happened'].map(csvCell).join(',')];
  for (const row of rows) {
    lines.push([row.at.toISOString(), KIND_WORDS[kindOf(row.action)], row.actorLabel, row.summary].map(csvCell).join(','));
  }
  const day = context.rt.now().toISOString().slice(0, 10);
  const slug = context.org.slug.replace(/[^a-z0-9-]/gi, '') || 'organization';
  // The byte order mark makes Excel read the file as UTF-8.
  return new Response(`﻿${lines.join('\r\n')}\r\n`, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="kitstak-billing-activity-${slug}-${day}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
