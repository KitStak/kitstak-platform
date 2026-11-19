import { NextResponse } from 'next/server';
import { DAY_EXISTS, DAY_STALE, DayConflict, saveProductionDay, toDomainContext } from '@/server/domain';
import { productionDayInput } from '@/server/actions/schemas';
import { orgHasPulseModule } from '@/server/entitlements';
import { DomainError } from '@/server/errors';
import { errorResponse, readJson } from '@/server/http/api';
import { trustedOrigins } from '@/server/env';
import { getApiContext } from '@/server/session';

/**
 * Saves a whole day of work on one job (the Work log form), all or nothing:
 * `PUT { jobId, workDate, mode: 'create' | 'edit', fromDate?, read?: [{ id, version }], lines: [...] }`.
 * Returns `{ data: { entries, created, updated, removed } }`.
 *
 * A day is never overwritten by accident. `create` on a day that already has work on the job, and
 * `edit` with rows that are not the ones on the day now (by id and version), both answer 409 with
 * `error.reason` ("day_exists" or "stale"), `error.workDate` and `error.fresh`: the day as it is now.
 */
export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin && !trustedOrigins().includes(origin)) throw new DomainError('FORBIDDEN', 'This request came from a site that is not allowed to change your data.');
    if (!origin && request.headers.get('sec-fetch-site') === 'cross-site') throw new DomainError('FORBIDDEN', 'This request came from a site that is not allowed to change your data.');
    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new DomainError('VALIDATION', 'Send the day as JSON.');
    const context = await getApiContext(request);
    if (!context) throw new DomainError('UNAUTHENTICATED', 'Sign in to KitStak to continue.');
    if (!(await orgHasPulseModule(context.org.id))) throw new DomainError('NOT_ENTITLED', 'KitStak Pulse is not turned on for this organization.');
    const ctx = toDomainContext(context);
    const parsed = productionDayInput.safeParse(await readJson(request));
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.join('.') || 'form'] ??= issue.message;
      throw new DomainError('VALIDATION', 'Some fields need another look.', fields);
    }
    try {
      return NextResponse.json({ data: await saveProductionDay(ctx, parsed.data) });
    } catch (error) {
      if (error instanceof DayConflict) {
        const message = error.reason === 'day_exists' ? DAY_EXISTS : DAY_STALE;
        return NextResponse.json({ error: { code: 'CONFLICT', message, reason: error.reason, workDate: error.workDate, fresh: error.fresh } }, { status: 409 });
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
