import { NextResponse } from 'next/server';
import { toDomainContext } from '@/server/domain';
import { listProduction, saveProductionEntry } from '@/server/domain';
import { productionInput } from '@/server/actions/schemas';
import { orgHasPulseModule } from '@/server/entitlements';
import { DomainError, isDomainError } from '@/server/errors';
import { errorResponse, readJson } from '@/server/http/api';
import { trustedOrigins } from '@/server/env';
import { getApiContext } from '@/server/session';

/**
 * Autosave of one grid row: `PUT { id?, jobId, workDate, shift?, laborClassId?, unitsGood?, ...,
 * version? }`. Returns `{ data: { entry, created } }`. When someone else changed the row first
 * the answer is 409 with `error.fresh` holding the row as it is now (SPEC 8.7).
 */
export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin && !trustedOrigins().includes(origin)) throw new DomainError('FORBIDDEN', 'This request came from a site that is not allowed to change your data.');
    if (!origin && request.headers.get('sec-fetch-site') === 'cross-site') throw new DomainError('FORBIDDEN', 'This request came from a site that is not allowed to change your data.');
    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new DomainError('VALIDATION', 'Send the row as JSON.');
    const context = await getApiContext(request);
    if (!context) throw new DomainError('UNAUTHENTICATED', 'Sign in to KitStak to continue.');
    if (!(await orgHasPulseModule(context.org.id))) throw new DomainError('NOT_ENTITLED', 'KitStak Pulse is not turned on for this organization.');
    const ctx = toDomainContext(context);
    const parsed = productionInput.safeParse(await readJson(request));
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.join('.') || 'form'] ??= issue.message;
      throw new DomainError('VALIDATION', 'Some fields need another look.', fields);
    }
    try {
      return NextResponse.json({ data: await saveProductionEntry(ctx, parsed.data) });
    } catch (error) {
      if (isDomainError(error) && error.code === 'CONFLICT' && parsed.data.id) {
        const [fresh] = (await listProduction(ctx, { jobId: parsed.data.jobId, from: parsed.data.workDate, to: parsed.data.workDate, includeDeleted: true })).filter((row) => row.id === parsed.data.id);
        return NextResponse.json({ error: { code: error.code, message: error.message, fresh: fresh ?? null } }, { status: 409 });
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
