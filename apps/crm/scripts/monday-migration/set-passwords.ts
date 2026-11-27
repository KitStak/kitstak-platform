/**
 * Generate credential logins for users that don't have one yet (Team1 members by default,
 * or the emails passed as arguments, e.g. an org's agent accounts).
 *
 * For each listed email without a Better Auth `credential` account row, generates a
 * random password, inserts the hashed credential, and appends the plaintext to the
 * file named by CRED_OUT (never printed to stdout). Idempotent: users that already
 * have a credential row are skipped.
 *
 * Usage (from apps/crm):
 *   DATABASE_URL=... BETTER_AUTH_SECRET=... BETTER_AUTH_URL=... \
 *     CRED_OUT=<path to gitignored secrets file> \
 *     pnpm exec tsx scripts/monday-migration/set-passwords.ts [email ...]
 *
 * Against production, run it from the repo root through deploy/with-prod-db.mjs (which sets
 * DATABASE_URL), e.g.
 *   CRED_OUT=<secrets file> CRED_LABEL="Driftwood agent logins" node deploy/with-prod-db.mjs \
 *     pnpm --filter kitstak-crm exec tsx scripts/monday-migration/set-passwords.ts maya@driftwood.example ...
 *
 * CRED_LABEL names the block in the secrets file (default "Team1 member logins").
 */
import '../load-env';
import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { db } from '../../src/server/db';
import { account, user } from '../../src/server/db/schema';

const TEAM1_EMAILS = [
  'lauren@team-01.com',
  'bryan@team-01.com',
  'franky@team-01.com',
  'josh@team-01.com',
  'chris@team-01.com',
  'tyler.bucholz@team-01.com',
] as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Emails from the command line (lowercased, de-duplicated), or the Team1 list when none are given. */
function targetEmails(argv: readonly string[]): readonly string[] {
  if (argv.length === 0) return TEAM1_EMAILS;
  const emails = [...new Set(argv.map((arg) => arg.trim().toLowerCase()))];
  const invalid = emails.filter((email) => !EMAIL.test(email));
  if (invalid.length > 0) throw new Error(`Not valid email addresses: ${invalid.join(', ')}`);
  return emails;
}

function generatePassword(): string {
  // ~96 bits of entropy plus classes to satisfy common password policies.
  return `${randomBytes(12).toString('base64url')}-Kit7!`;
}

async function main(): Promise<void> {
  const outPath = process.env.CRED_OUT;
  if (!outPath) throw new Error('CRED_OUT is required (path to a gitignored secrets file)');
  const emails = targetEmails(process.argv.slice(2));
  const label = process.env.CRED_LABEL?.trim() || 'Team1 member logins';

  const users = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(inArray(user.email, [...emails]));
  const byEmail = new Map(users.map((row) => [row.email, row.id]));

  const lines: string[] = [];
  for (const email of emails) {
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
      `\n# ── ${label} (generated ${new Date().toISOString().slice(0, 10)}; ask each user to change theirs) ──\n${lines.join('\n')}\n`,
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
