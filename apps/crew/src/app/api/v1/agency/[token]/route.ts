/**
 * POST /api/v1/agency/[token] (SPEC 8.8): the agency link submit. Public (no session), JSON only,
 * up to 50 rows a request, rate limited per link and sender. Answers never echo the token.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AGENCY_ROWS_PER_REQUEST, submitAgencyRows } from '@/server/domain/agency-public';
import { DomainError } from '@/server/errors';
import { assertSafeOrigin, errorResponse, readJson } from '@/server/http/api';

export const dynamic = 'force-dynamic';

const rowSchema = z.object({
  firstName: z.string().max(200),
  lastName: z.string().max(200),
  phone: z.string().max(200).nullable().optional(),
  email: z.string().max(300).nullable().optional(),
  agencyRef: z.string().max(200).nullable().optional(),
  startDate: z.string().max(40).nullable().optional(),
  language: z.string().max(10).nullable().optional(),
});
const bodySchema = z.object({ rows: z.array(rowSchema).min(1).max(AGENCY_ROWS_PER_REQUEST) });

const HEADERS = { 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex', 'cache-control': 'no-store' };

export async function POST(request: Request, route: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  try {
    assertSafeOrigin(request);
    if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) throw new DomainError('VALIDATION', 'Send the request as JSON.');
    const { token } = await route.params;
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) throw new DomainError('VALIDATION', `Send 1 to ${AGENCY_ROWS_PER_REQUEST} people, each with a first and last name.`);
    const sender = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
    const result = await submitAgencyRows(token, parsed.data.rows, sender);
    return NextResponse.json({ data: result }, { headers: HEADERS });
  } catch (error) {
    const response = errorResponse(error);
    for (const [key, value] of Object.entries(HEADERS)) response.headers.set(key, value);
    return response;
  }
}
