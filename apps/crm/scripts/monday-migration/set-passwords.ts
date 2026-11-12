/**
 * Generate credential logins for Team1 members that don't have one yet.
 *
 * For each listed email without a Better Auth `credential` account row, generates a
 * random password, inserts the hashed credential, and appends the plaintext to the
 * file named by CRED_OUT (never printed to stdout). Idempotent: users that already
 * have a credential row are skipped.
 *
 * Usage (from apps/crm):
 *   DATABASE_URL=... BETTER_AUTH_SECRET=... BETTER_AUTH_URL=... \
 *     CRED_OUT=<path to gitignored secrets file> \
 *     pnpm exec tsx scripts/monday-migration/set-passwords.ts
 */
import '../load-env';
import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { db } from '../../src/server/db';
import { account, user } from '../../src/server/db/schema';

const EMAILS = [
  'lauren@team-01.com',
  'bryan@team-01.com',
  'franky@team-01.com',
  'josh@team-01.com',
  'chris@team-01.com',
  'tyler.bucholz@team-01.com',
] as const;

function generatePassword(): string {
  // ~96 bits of entropy plus classes to satisfy common password policies.
  return `${randomBytes(12).toString('base64url')}-Kit7!`;
}

async function main(): Promise<void> {
  const outPath = process.env.CRED_OUT;
  if (!outPath) throw new Error('CRED_OUT is required (path to a gitignored secrets file)');

  const users = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(inArray(user.email, [...EMAILS]));
  const byEmail = new Map(users.map((row) => [row.email, row.id]));

  const lines: string[] = [];
  for (const email of EMAILS) {
    const userId = byEmail.get(email);
    if (!userId) {
      console.log(`missing user, skipped: ${email}`);
      continue;
    }
    const [existing] = await db
      .select({ id: account.id })
      .from(account)
      .where(eq(account.userId, userId))
      .limit(1);
    if (existing) {
      console.log(`credential exists, skipped: ${email}`);
      continue;
    }
    const password = generatePassword();
    await db.insert(account).values({
      accountId: userId,
      providerId: 'credential',
      userId,
      password: await hashPassword(password),
      updatedAt: new Date(),
    });
    lines.push(`# ${email}\n${email.split('@')[0]?.replace(/[^a-z]/gi, '_').toUpperCase()}_PASSWORD=${password}`);
    console.log(`credential created: ${email}`);
  }

  if (lines.length > 0) {
    appendFileSync(
      outPath,
      `\n# ── Team1 member logins (generated ${new Date().toISOString().slice(0, 10)}; ask each user to change theirs) ──\n${lines.join('\n')}\n`,
      'utf8',
    );
    console.log(`\n${lines.length} password(s) written to ${outPath}`);
  } else {
    console.log('\nNothing to do.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
