/**
 * Program change notes for Pulse (docs/programs/SPEC.md 4.2 `events.ts`): one
 * `pm_program_changed` bridge event per program after a change that moves money or units. Runs in
 * a savepoint of the caller's transaction and never throws, so a Pulse problem never breaks a
 * Projects write. Pending events for one program fold into one.
 */
import 'server-only';
import { emitBridgeEvent } from '@kitstak/pulse-bridge';
import { db, type Executor } from '@/server/db';
import type { DomainContext } from '../_shared';
import { bridge } from './_program';

export async function emitProgramChanged(executor: Executor, ctx: DomainContext, programId: string | null | undefined): Promise<void> {
  if (!programId) return;
  try {
    await emitBridgeEvent(bridge(executor), { orgId: ctx.orgId }, { kind: 'pm_program_changed', targetId: programId });
  } catch {
    // Pulse is away: nothing to tell.
  }
}

/** After commit form for many programs. */
export async function emitProgramsChanged(ctx: DomainContext, programIds: Iterable<string | null | undefined>): Promise<void> {
  for (const id of new Set([...programIds].filter((value): value is string => Boolean(value)))) await emitProgramChanged(db, ctx, id);
}
