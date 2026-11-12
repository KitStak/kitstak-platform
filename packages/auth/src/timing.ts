/**
 * Timing equalizer for early-reject auth paths (auth review 2026-11-11, round 2 NEW-5).
 *
 * The lockout before-gate and app sign-in gates (inactive user, SSO enforce) refuse a
 * request BEFORE any password hashing runs, while a genuine wrong-password rejection
 * costs a full scrypt verification. That difference is a timing oracle: an attacker who
 * measures response time can distinguish "gated account" (locked / inactive / SSO-only)
 * from "wrong password" even though both answer with the same generic message. Burning
 * one scrypt verification against a static throwaway hash before throwing makes the
 * early rejection cost roughly the same as a real credential check.
 */
import { verifyPassword } from 'better-auth/crypto';

/**
 * A real Better Auth scrypt hash (`salt:key` hex) of a random throwaway string. It
 * protects nothing: the verify result is always discarded. It only exists so the
 * early-reject paths spend one genuine KDF run.
 */
const DUMMY_SCRYPT_HASH =
  '6eb6d8a128b2361ba775528395eccb10:1ed0b4b88fe1c4d55be5a0e060e6559145083d0f3b16f2d7f3154ff9d4c1092e3b4a10c37a979a5fd187f335df9b90c454c5158cda767a7f47427ee360addb71';

/**
 * Runs one scrypt verification against the static dummy hash and discards the result.
 * Never throws: a failure here must not change the caller's rejection behaviour.
 */
export async function burnDummyPasswordVerify(password?: unknown): Promise<void> {
  try {
    await verifyPassword({
      hash: DUMMY_SCRYPT_HASH,
      password: typeof password === 'string' && password.length > 0 ? password : 'kitstak-dummy',
    });
  } catch {
    // Intentionally swallowed: the caller is about to throw its own generic rejection.
  }
}
