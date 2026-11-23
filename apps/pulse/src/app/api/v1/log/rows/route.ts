import { NextResponse } from 'next/server';
import { z } from 'zod';
import { toDomainContext } from '@/server/domain';
import { DAY_CHANGED, listProduction, saveProductionEntry } from '@/server/domain';
import { productionInput, uuid } from '@/server/actions/schemas';
import { orgHasPulseModule } from '@/server/entitlements';
import { DomainError, isDomainError } from '@/server/errors';
import { errorResponse, readJson } from '@/server/http/api';
import { trustedOrigins } from '@/server/env';
import { getApiContext } from '@/server/session';

/** The row, plus the ids of the lines of that job and day the editor has on screen. */
const rowInput = productionInput.extend({ seen: z.array(uuid).max(500).optional() });

/**
 * Autosave of one grid row: `PUT { id?, jobId, workDate, shift?, laborClassId?, unitsGood?, ...,
 * version?, seen? }`. Returns `{ data: { entry, created } }`. When someone else changed the row
 * first the answer is 409 with `error.fresh` holding the row as it is now (SPEC 8.7).
 *
 * A new line (no `id`) must list in `seen` the lines of that job and day the editor shows. If the
 * day holds a line it did not list, the answer is 409 with `error.reason` "day_changed" and
 * `error.day`, the day as it is now: the same rule as the day form, which refuses a new day on a
 * day with work. Leaving `seen` out counts as having seen no line.
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
    const parsed = rowInput.safeParse(await readJson(request));
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.join('.') || 'form'] ??= issue.message;
      throw new DomainError('VALIDATION', 'Some fields need another look.', fields);
    }
    const { seen, ...input } = parsed.data;
    try {
      // An open editor must send the version it read: a missing or old one is a 409, never an overwrite.
      return NextResponse.json({ data: await saveProductionEntry(ctx, input, { requireVersion: true, knownDayIds: seen ?? [] }) });
    } catch (error) {
      if (isDomainError(error) && error.code === 'CONFLICT') {
        // The row as it is now: by id, or (a line the editor thought was new) by job, day, shift, labor class and task.
        const sameDay = await listProduction(ctx, { jobId: input.jobId, from: input.workDate, to: input.workDate, includeDeleted: Boolean(input.id) });
        const shift = input.shift?.trim() || 'day';
        const fresh = input.id
          ? sameDay.find((row) => row.id === input.id)
          : sameDay.find((row) => row.deletedAt === null && row.shift === shift && row.laborClassId === (input.laborClassId ?? null) && row.pmTaskId === (input.pmTaskId ?? null));
        const dayChanged = error.message === DAY_CHANGED;
        return NextResponse.json(
          {
            error: {
              code: error.code,
              message: error.message,
              fresh: fresh ?? null,
              ...(dayChanged ? { reason: 'day_changed', day: sameDay.filter((row) => row.deletedAt === null) } : {}),
            },
          },
          { status: 409 },
        );
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
