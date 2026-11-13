/**
 * Runs one command with the production database address in its environment, built from
 * deploy/secrets.env exactly as push-env.mjs builds it. The address is never printed and
 * never has to be typed or pasted into a shell.
 *
 * Usage (from the repo root of the checkout that holds deploy/secrets.env):
 *   node deploy/with-prod-db.mjs pnpm --filter @kitstak/db db:migrate
 *   node deploy/with-prod-db.mjs pnpm --filter kitstak-crm exec tsx scripts/provision-org-owner.ts --email ...
 *
 * Set KITSTAK_SECRETS to the file's full path to run from another checkout (a worktree).
 * The command inherits this terminal, so prompts (confirmations, hidden password entry) work.
 *
 * Both DATABASE_URL and DIRECT_URL are set to the session-mode address (port 5432): the
 * migration runner needs a session for its advisory lock, and one-off scripts do not need
 * the transaction pooler.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SUPABASE_REF = 'uvrcwgyzbtcujcbdwjom';
const SECRETS_PATH = process.env.KITSTAK_SECRETS ?? path.join(process.cwd(), 'deploy', 'secrets.env');

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function readDbPassword(file) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^DB_PASSWORD=(.*)$/.exec(line.trim());
    if (match) return match[1].trim();
  }
  return '';
}

const [command, ...args] = process.argv.slice(2);
if (!command) fail('Nothing to run. Usage: node deploy/with-prod-db.mjs <command> [args...]');
if (!existsSync(SECRETS_PATH)) fail(`${SECRETS_PATH} not found. Run from the repo root or set KITSTAK_SECRETS.`);

const dbPassword = readDbPassword(SECRETS_PATH);
if (!dbPassword || dbPassword.includes('PASTE_')) fail('Fill in DB_PASSWORD in deploy/secrets.env.');

const sessionUrl = `postgres://postgres.${SUPABASE_REF}:${encodeURIComponent(dbPassword)}@aws-1-us-west-1.pooler.supabase.com:5432/postgres`;

const isWindows = process.platform === 'win32';
/** Under a Windows shell, arguments with spaces (a person's name) must be quoted to stay whole. */
const shellSafe = (arg) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '')}"`);

console.error(`Running against the PRODUCTION database (${SUPABASE_REF}): ${command} ${args.join(' ')}`);
const result = spawnSync(command, isWindows ? args.map(shellSafe) : args, {
  stdio: 'inherit',
  // pnpm is a .cmd shim on Windows, which needs a shell to launch.
  shell: isWindows,
  env: { ...process.env, DATABASE_URL: sessionUrl, DIRECT_URL: sessionUrl },
});
if (result.error) fail(`Could not start ${command}: ${result.error.message}`);
process.exit(result.status ?? 1);
