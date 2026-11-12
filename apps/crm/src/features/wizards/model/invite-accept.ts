/**
 * Invitation accept page rules (pure): which state a copied invite link lands in for the
 * signed-in user. Mirrors Better Auth's own checks so the page explains a refusal up front.
 */
export type InviteAcceptState = 'invalid' | 'revoked' | 'accepted' | 'expired' | 'mismatch' | 'member' | 'ready';

export interface InviteAcceptInput {
  readonly status: string;
  readonly expiresAt: Date | string;
  readonly invitedEmail: string;
  readonly sessionEmail: string;
  /** The signed-in user already belongs to the inviting organization. */
  readonly isMember: boolean;
  readonly now?: number;
}

export function inviteAcceptState(input: InviteAcceptInput | null): InviteAcceptState {
  if (!input) return 'invalid';
  const isInvitee = input.invitedEmail.trim().toLowerCase() === input.sessionEmail.trim().toLowerCase();
  // The invitee already joined: just open the org. (A teammate who opens someone else's link
  // is also a member, but must see whom the invitation is for.)
  if (isInvitee && input.isMember) return 'member';
  if (input.status === 'accepted') return 'accepted';
  if (input.status !== 'pending') return 'revoked';
  const expires = new Date(input.expiresAt).getTime();
  if (!Number.isFinite(expires) || expires <= (input.now ?? Date.now())) return 'expired';
  if (!isInvitee) return 'mismatch';
  return 'ready';
}

/** "a•••@northwind.example": enough to recognise the address without exposing it to the wrong account. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!domain) return '•••';
  return `${local.slice(0, 1)}•••@${domain}`;
}
