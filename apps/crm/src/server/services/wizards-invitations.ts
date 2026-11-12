/**
 * Bulk invitations for the invite-members wizard. Each invitee is processed on its own so one
 * bad row (already a member, role not allowed) does not block the rest; the caller gets a
 * per-email result to show inline.
 */
import { z } from 'zod';
import { AppError } from '@/server/http/errors';
import type { ServiceContext } from './context';
import type { InvitationDto } from './contracts/dto';
import { bulkInvitationSchema, createInvitation } from './members';

export { bulkInvitationSchema };
export type BulkInvitationInput = z.infer<typeof bulkInvitationSchema>;

export type BulkInvitationResult =
  | { readonly email: string; readonly ok: true; readonly invitation: InvitationDto }
  | { readonly email: string; readonly ok: false; readonly code: string; readonly message: string };

export async function createInvitations(
  ctx: ServiceContext,
  input: BulkInvitationInput,
): Promise<BulkInvitationResult[]> {
  const results: BulkInvitationResult[] = [];
  const seen = new Set<string>();
  for (const entry of input.invitations) {
    if (seen.has(entry.email)) continue;
    seen.add(entry.email);
    try {
      const invitation = await createInvitation(ctx, entry);
      results.push({ email: entry.email, ok: true, invitation });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      results.push({ email: entry.email, ok: false, code: error.code, message: error.message });
    }
  }
  return results;
}
