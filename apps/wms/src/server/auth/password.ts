/**
 * Password hashing (bcrypt). Dependency-free beyond bcryptjs so the seed (run via tsx with
 * a relative import) can use it.
 */
import bcrypt from 'bcryptjs';

/** Cost factor for new hashes. Existing lower-cost hashes still verify (see `needsRehash`). */
export const BCRYPT_ROUNDS = 12;
/** bcrypt only uses the first 72 bytes; longer inputs are rejected by the policy. */
export const MAX_PASSWORD_BYTES = 72;

export function hashPassword(password: string, rounds: number = BCRYPT_ROUNDS): string {
  return bcrypt.hashSync(password, rounds);
}

export function verifyPassword(password: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(password, hash);
  } catch {
    return false; // malformed hash
  }
}

export async function hashPasswordAsync(password: string, rounds: number = BCRYPT_ROUNDS): Promise<string> {
  return bcrypt.hash(password, rounds);
}

export async function verifyPasswordAsync(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/** True when the stored hash uses fewer rounds than the current cost factor. */
export function needsRehash(hash: string, rounds: number = BCRYPT_ROUNDS): boolean {
  try {
    return bcrypt.getRounds(hash) < rounds;
  } catch {
    return true;
  }
}
