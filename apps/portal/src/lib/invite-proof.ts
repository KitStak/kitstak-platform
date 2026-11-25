/**
 * The invite proof cookie (docs/billing/CONTRACTS.md section 24). PURE: shared by the proxy, which
 * stores the proof from the emailed link, and by the signup server actions, which check it.
 *
 * The link in the invite email is `/invite/<id>?t=<proof>`. The proxy moves the proof into an
 * httpOnly cookie and sends the browser on to the clean address, so the proof never sits in the
 * address bar, in history or in a Referer header, and it survives a detour through sign in.
 */
export const INVITE_PROOF_COOKIE = 'kitstak.invite_proof';
/** As long as an invite itself lasts. */
export const INVITE_PROOF_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const INVITE_PATH = /^\/invite\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
const PROOF_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** The invitation id of an invite page path, lower case. null for any other path. */
export function invitationIdFromPath(pathname: string): string | null {
  const match = INVITE_PATH.exec(pathname);
  return match?.[1] ? match[1].toLowerCase() : null;
}

/** True when the value has the shape of a proof. The real check needs the secret and runs on the server. */
export function looksLikeInviteProof(value: string | null | undefined): value is string {
  return typeof value === 'string' && PROOF_SHAPE.test(value);
}

export function inviteProofCookieValue(invitationId: string, proof: string): string {
  return `${invitationId.toLowerCase()}.${proof}`;
}

/** The proof stored for this invitation, or null when the cookie is for another invite or malformed. */
export function proofFromCookie(cookieValue: string | null | undefined, invitationId: string): string | null {
  if (typeof cookieValue !== 'string') return null;
  const at = cookieValue.indexOf('.');
  if (at <= 0) return null;
  const id = cookieValue.slice(0, at);
  const proof = cookieValue.slice(at + 1);
  if (id !== invitationId.toLowerCase() || !looksLikeInviteProof(proof)) return null;
  return proof;
}
