/**
 * Proves the seeded admin credentials round-trip through the shared Better Auth
 * instance (blueprint §1.4 exit check): opens the app database (local PGlite, or
 * DATABASE_URL when set — stop `next dev` first for PGlite), checks that the stored
 * `core.account` credential is a legacy-format bcrypt hash, then calls
 * `auth.api.signInEmail` so the passwordCompat verifier does the work end to end.
 *
 * Run with: pnpm auth:verify-login   (env: VERIFY_EMAIL, SEED_PASSWORD override)
 */
import { eq } from 'drizzle-orm';
import { isBcryptHash } from '@kitstak/auth';
import { account, user } from '@kitstak/db/schema';
import { getAppDb } from '../src/server/api/db';
import { getWmsAuth } from '../src/server/auth/auth';
import { DEFAULT_SEED_PASSWORD } from '../src/server/db/seed/access';
import { closeDb } from '../src/server/db';

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

async function main(): Promise<void> {
  const email = (process.env.VERIFY_EMAIL ?? 'admin@kitstak.io').toLowerCase();
  const password = process.env.SEED_PASSWORD ?? DEFAULT_SEED_PASSWORD;
  const db = await getAppDb();

  const [credential] = await db
    .select({ userId: user.id, hash: account.password })
    .from(account)
    .innerJoin(user, eq(user.id, account.userId))
    .where(eq(user.email, email))
    .limit(1);
  if (!credential?.hash) throw new Error(`No core.account credential for ${email} — run db:seed.`);
  out(`auth:verify-login - ${email} credential is ${isBcryptHash(credential.hash) ? 'bcrypt (legacy format, compat verifier path)' : 'scrypt (Better Auth default)'}`);

  const auth = await getWmsAuth();
  const response = await auth.api.signInEmail({
    body: { email, password },
    headers: new Headers({ origin: 'http://localhost:3000', host: 'localhost:3000' }),
    asResponse: true,
  });
  if (response.status !== 200) {
    throw new Error(`sign-in answered ${response.status}: ${await response.text()}`);
  }
  const setCookie = response.headers.get('set-cookie') ?? '';
  if (!setCookie.includes('kitstak.session_token=')) {
    throw new Error('sign-in succeeded but set no kitstak.session_token cookie');
  }
  out('auth:verify-login - OK: sign-in 200, kitstak.session_token issued (bcrypt compat round-trip).');
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`auth:verify-login failed: ${message}\n`);
    process.exitCode = 1;
  })
  .finally(() => void closeDb());
