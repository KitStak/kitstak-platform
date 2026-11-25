import { NextResponse } from 'next/server';
import { apiRoute } from '@/server/http/api';
import { programTrends, trendsCsv } from '@/server/domain/programs';
import { fileRoute, monthParam } from '../_lib';

function input(searchParams: URLSearchParams) {
  const now = new Date().toISOString().slice(0, 7);
  const to = monthParam(searchParams.get('to')) ?? now;
  const from = monthParam(searchParams.get('from')) ?? to;
  const group = searchParams.get('group') === 'customer' ? 'customer' : 'program';
  return { from, to, groupBy: group } as const;
}

const json = apiRoute(async ({ ctx, searchParams }) => programTrends(ctx, input(searchParams)));
const csv = fileRoute(async ({ ctx, searchParams }) => ({ ...(await trendsCsv(ctx, input(searchParams))), contentType: 'text/csv; charset=utf-8' }));

/** GET /api/v1/programs/trends?from=&to=&group=program|customer&format=json|csv */
export async function GET(request: Request, route: { params: Promise<Record<string, never>> }): Promise<Response> {
  const format = new URL(request.url).searchParams.get('format');
  if (format === 'csv') return csv(request, route);
  return json(request, route) as Promise<NextResponse>;
}
