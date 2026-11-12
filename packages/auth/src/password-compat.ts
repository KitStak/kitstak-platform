/**
 * Password hashing compatibility layer (blueprint §1.1 `password-compat.ts`).
 *
 * WMS legacy credentials are bcrypt hashes migrated verbatim into `account.password`.
 * `verify` detects the bcrypt `$2a$` / `$2b$` / `$2y$` prefixes and checks them with
 * bcryptjs; everything else delegates to Better Auth's default scrypt verify. `hash`
 * is always the Better Auth default, so every newly (re)hashed password is scrypt.
 *
 * A successful bcrypt verification fires `onLegacyVerified`, so the consuming app can
 * rehash-to-default (e.g. in an `after` hook on sign-in, where the plaintext password
 * from the request body can be re-hashed via `auth.api.setUserPassword` equivalents).
 */
import bcrypt from 'bcryptjs';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$/;

/** True when the stored hash is a legacy WMS bcrypt hash. */
export function isBcryptHash(hash: string): boolean {
  return BCRYPT_HASH_PATTERN.test(hash);
}

export interface LegacyVerifiedContext {
  /** The stored legacy bcrypt hash that just verified. */
  readonly hash: string;
  /** The plaintext password that verified (use it to rehash, never persist it). */
  readonly password: string;
}

export interface PasswordCompatOptions {
  /** Called after a legacy bcrypt hash verifies successfully; use it to trigger a rehash. */
  onLegacyVerified?: (context: LegacyVerifiedContext) => void | Promise<void>;
}

export interface PasswordHasher {
  hash: (password: string) => Promise<string>;
  verify: (data: { hash: string; password: string }) => Promise<boolean>;
}

/** Builds the `emailAndPassword.password` override for `betterAuth()`. */
export function createPasswordCompat(options: PasswordCompatOptions = {}): PasswordHasher {
  return {
    hash: (password) => hashPassword(password),
    verify: async ({ hash, password }) => {
      if (isBcryptHash(hash)) {
        let ok = false;
        try {
          ok = await bcrypt.compare(password, hash);
        } catch {
          return false; // malformed hash
        }
        if (ok && options.onLegacyVerified) await options.onLegacyVerified({ hash, password });
        return ok;
      }
      return verifyPassword({ hash, password });
    },
  };
}
