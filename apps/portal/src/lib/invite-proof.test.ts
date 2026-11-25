import { describe, expect, test } from 'vitest';
import { inviteProofCookieValue, invitationIdFromPath, looksLikeInviteProof, proofFromCookie } from './invite-proof';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const PROOF = 'A'.repeat(43);

describe('invite proof cookie', () => {
  test('only an invite page path gives an invitation id', () => {
    expect(invitationIdFromPath(`/invite/${ID}`)).toBe(ID);
    expect(invitationIdFromPath(`/invite/${ID.toUpperCase()}/`)).toBe(ID);
    expect(invitationIdFromPath('/invite/not-an-id')).toBeNull();
    expect(invitationIdFromPath(`/billing/${ID}`)).toBeNull();
    expect(invitationIdFromPath(`/invite/${ID}/more`)).toBeNull();
  });

  test('a proof has one shape', () => {
    expect(looksLikeInviteProof(PROOF)).toBe(true);
    expect(looksLikeInviteProof('short')).toBe(false);
    expect(looksLikeInviteProof(`${PROOF}=`)).toBe(false);
    expect(looksLikeInviteProof(null)).toBe(false);
  });

  test('the cookie only answers for its own invitation', () => {
    const value = inviteProofCookieValue(ID, PROOF);
    expect(proofFromCookie(value, ID)).toBe(PROOF);
    expect(proofFromCookie(value, ID.toUpperCase())).toBe(PROOF);
    expect(proofFromCookie(value, '11111111-d9cb-469f-a165-70867728950e')).toBeNull();
    expect(proofFromCookie(`${ID}.nope`, ID)).toBeNull();
    expect(proofFromCookie(undefined, ID)).toBeNull();
    expect(proofFromCookie('garbage', ID)).toBeNull();
  });
});
