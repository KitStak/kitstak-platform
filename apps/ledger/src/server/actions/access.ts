'use server';
/** Access actions: the claim step and role changes (SPEC 3.2). */
import { z } from 'zod';
import { claimLedger, setMemberRole } from '@/server/domain/access';
import { LEDGER_ROLES } from '@/lib/permissions';
import { runAction, type ActionResult } from './_action';

export async function claimLedgerAction(): Promise<ActionResult<void>> {
  return runAction(z.object({}), {}, (_data, ctx) => claimLedger(ctx));
}

const setRoleSchema = z.object({ userId: z.uuid(), role: z.enum(LEDGER_ROLES) });

export async function setMemberRoleAction(input: z.input<typeof setRoleSchema>): Promise<ActionResult<void>> {
  return runAction(setRoleSchema, input, (data, ctx) => setMemberRole(ctx, data.userId, data.role));
}
