/**
 * Proof that a person came from the invite email (review round 1, docs/billing/CONTRACTS.md section
 * 24). The link in the email carries `?t=<proof>`: an HMAC of the invitation id and the invited
 * address, made with the shared auth secret. Only the mailbox that got the email has it. The
 * invitation id alone is not proof, because the people who sent the invite can see that id.
 *
 * Accepting an invite with a valid proof shows the person owns the address, so their email is marked
 * verified and they are never asked for a 6 digit code.
 *
 * Review round 4: without a proof, an account whose email is not confirmed can no longer accept
 * (`beforeAcceptInvitation` in `auth-hooks.ts`), and the Portal makes no account from a bare
 * invite address. Before, the invite "still worked" without the proof, and an admin who read the
 * id of an owner's billing invite could make the account and take it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const PROOF_LENGTH = 43;

function digest(secret: string, invitationId: string, email: string): string {
  return createHmac('sha256', secret)
    .update(`kitstak-invite-proof:v1:${invitationId.trim().toLowerCase()}:${email.trim().toLowerCase()}`)
    .digest('base64url');
}

/** The value for the `t` query parameter of the invite link. */
export function signInviteProof(secret: string, invitationId: string, email: string): string {
  return digest(secret, invitationId, email);
}

/** True when `proof` was made by `signInviteProof` for this invitation and this address. */
export function verifyInviteProof(secret: string, invitationId: string, email: string, proof: string | null | undefined): boolean {
  if (typeof proof !== 'string' || proof.length !== PROOF_LENGTH || !secret) return false;
  const expected = Buffer.from(digest(secret, invitationId, email));
  const given = Buffer.from(proof);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
