import { apiRoute } from '@/server/http/api';
import { getStatement, statementCsv, statementPdf } from '@/server/domain/programs';
import { fileRoute, requireMonth } from '../../_lib';

type Params = { key: string };
const json = apiRoute<Params>(async ({ ctx, params, searchParams }) => getStatement(ctx, decodeURIComponent(params.key), requireMonth(searchParams.get('month'))));
const csv = fileRoute<Params>(async ({ ctx, params, searchParams }) => ({ ...(await statementCsv(ctx, decodeURIComponent(params.key), requireMonth(searchParams.get('month')))), contentType: 'text/csv; charset=utf-8' }));
const pdf = fileRoute<Params>(async ({ ctx, params, searchParams }) => ({ ...(await statementPdf(ctx, decodeURIComponent(params.key), requireMonth(searchParams.get('month')))), contentType: 'application/pdf' }));

/** GET /api/v1/programs/:key/statement?month=&format=json|csv|pdf (needs money:read). */
export async function GET(request: Request, route: { params: Promise<Params> }): Promise<Response> {
  const format = new URL(request.url).searchParams.get('format');
  if (format === 'csv') return csv(request, route);
  if (format === 'pdf') return pdf(request, route);
  return json(request, route);
}
