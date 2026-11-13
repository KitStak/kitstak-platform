/**
 * Provisions one new organization with its owner, by hand, while sign-up plus billing is not
 * yet a self-serve path. In ONE transaction it creates:
 *
 *  - the user (email verified) and their email + password credential
 *  - the organization and the owner membership
 *  - one entitlement per module in --modules (source 'manual'); anything not listed stays locked
 *  - unless --keep-onboarding: the rows that keep every guided-setup surface closed
 *  - unless --no-password-change: a core.password_change_required row, so the portal and CRM
 *    send the user to "Choose a new password" until the provisioned password is replaced
 *
 * It refuses to run if the email or the org slug already exists, and changes nothing then.
 *
 * Usage (from apps/crm; DATABASE_URL must point at the core database):
 *   pnpm tsx scripts/provision-org-owner.ts --email dana@northwind.example --name "Dana Reyes" \
 *     --org "Northwind Supply" --slug northwind --modules crm
 *
 * The password is never a flag (it would land in shell history): it is asked for twice
 * without echo. Only when there is no terminal is it read from PROVISION_PASSWORD (avoid
 * setting that inline, for the same reason). Before anything is written you are asked to
 * type the org slug to confirm; pass --yes to skip that in automation. Add --dry-run to
 * check the inputs and print the plan without connecting.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { eq, sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { createPgClient, schema } from '@kitstak/db/client-pg';
import { grantModule } from '@kitstak/entitlements';
import { USAGE, onboardingRows, parseOwnerSpec, passwordProblems, type OwnerSpec } from '../src/server/provisioning/owner-spec';

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Asks a question on the terminal without echoing what is typed. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    let isMuted = false;
    const output = new Writable({
      write(chunk, _encoding, done) {
        if (!isMuted) process.stdout.write(chunk);
        done();
      },
    });
    const reader = createInterface({ input: process.stdin, output, terminal: true });
    reader.question(question, (answer) => {
      reader.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    isMuted = true;
  });
}

/** Asks a plain question on the terminal. */
function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const reader = createInterface({ input: process.stdin, output: process.stdout });
    reader.question(question, (answer) => {
      reader.close();
      resolve(answer.trim());
    });
  });
}

/** A mistyped email would hand an owner account to someone else, so the plan is confirmed. */
async function confirmPlan(spec: OwnerSpec): Promise<void> {
  if (spec.assumeYes) return;
  if (!process.stdin.isTTY) fail('No terminal to confirm on. Re-run with --yes once the plan above is right.');
  const answer = await ask(`Type the org slug (${spec.orgSlug}) to create this owner account: `);
  if (answer !== spec.orgSlug) fail('Not confirmed. Nothing was changed.');
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.PROVISION_PASSWORD;
  // Do not leave the password in this process's environment for anything spawned later.
  delete process.env.PROVISION_PASSWORD;
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) fail('No terminal to ask for the password on. Set PROVISION_PASSWORD instead.');
  const first = await askHidden('Password for the new user: ');
  const second = await askHidden('Type it again: ');
  if (first !== second) fail('The two passwords do not match. Nothing was changed.');
  return first;
}

function describePlan(spec: OwnerSpec): string {
  return [
    `  user          ${spec.name} <${spec.email}> (owner)`,
    `  organization  ${spec.orgName} (slug ${spec.orgSlug})`,
    `  modules       ${spec.modules.join(', ')} (everything else stays locked)`,
    `  onboarding    ${spec.skipOnboarding ? 'skipped (guides closed)' : 'shown as for any new org'}`,
    `  password      ${spec.requirePasswordChange ? 'must be changed at first sign-in' : 'kept as provisioned'}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const parsed = parseOwnerSpec(process.argv.slice(2));
  if (!parsed.ok) fail(`${parsed.errors.join('\n')}\n\n${USAGE}`);
  const spec = parsed.spec;

  process.stdout.write(`About to provision:\n${describePlan(spec)}\n`);
  if (spec.dryRun) {
    process.stdout.write('Dry run: nothing was changed.\n');
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) fail('DATABASE_URL is required and must point at the core database.');

  await confirmPlan(spec);
  const password = await readPassword();
  const problems = passwordProblems(password, spec);
  if (problems.length > 0) fail(`That password does not meet the sign-up policy: ${problems.join(' ')}`);
  const credentialHash = await hashPassword(password);

  const client = createPgClient(connectionString, { applicationName: 'kitstak-provision-org-owner', max: 1 });
  try {
    const { user, account, organization, member, onboardingProgress, passwordChangeRequired } = schema;

    // Case-insensitive: an older row stored with capitals is still the same mailbox.
    const [existingUser] = await client.db
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = ${spec.email}`)
      .limit(1);
    if (existingUser) fail(`A user with the email ${spec.email} already exists. Nothing was changed.`);
    const [existingOrg] = await client.db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, spec.orgSlug))
      .limit(1);
    if (existingOrg) fail(`An organization with the slug '${spec.orgSlug}' already exists. Nothing was changed.`);

    const created = await client.db.transaction(async (tx) => {
      const now = new Date();
      const [newUser] = await tx
        .insert(user)
        .values({ name: spec.name, email: spec.email, emailVerified: true })
        .returning({ id: user.id });
      if (!newUser) throw new Error('User insert returned no row.');

      await tx.insert(account).values({
        accountId: newUser.id,
        providerId: 'credential',
        userId: newUser.id,
        password: credentialHash,
        updatedAt: now,
      });

      const [newOrg] = await tx
        .insert(organization)
        .values({
          name: spec.orgName,
          slug: spec.orgSlug,
          createdAt: now,
          metadata: JSON.stringify({ source: 'provision-org-owner', provisionedAt: now.toISOString() }),
        })
        .returning({ id: organization.id });
      if (!newOrg) throw new Error('Organization insert returned no row.');

      await tx.insert(member).values({ organizationId: newOrg.id, userId: newUser.id, role: 'owner', createdAt: now });

      for (const grantedModule of spec.modules) await grantModule(tx, newOrg.id, grantedModule, 'manual');

      if (spec.skipOnboarding) {
        await tx.insert(onboardingProgress).values(
          onboardingRows(spec).map((row) => ({ ...row, orgId: newOrg.id, completedBy: newUser.id })),
        );
      }

      if (spec.requirePasswordChange) {
        await tx.insert(passwordChangeRequired).values({ userId: newUser.id, credentialHash, reason: 'provisioned' });
      }

      return { userId: newUser.id, orgId: newOrg.id };
    });

    process.stdout.write(`Done.\n  user id  ${created.userId}\n  org id   ${created.orgId}\n`);
  } finally {
    await client.close();
  }
}

/**
 * A database error's own message, without the failed query's parameters: Drizzle's wrapper
 * message lists them, and here they include the credential hash.
 */
function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Unexpected error.';
  const cause = error.cause instanceof Error ? error.cause.message : null;
  if (cause) return `Database error: ${cause}`;
  return error.message.startsWith('Failed query') ? 'Database error: the query failed.' : error.message;
}

main().catch((error: unknown) => {
  fail(`${safeErrorMessage(error)}\nNothing was changed.`);
});
