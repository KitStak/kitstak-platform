/**
 * Playwright global setup:
 *   1. ensure embedded Postgres + dev server on :3100 are healthy (starts them if needed);
 *   2. log in once as the seeded demo admin and save `e2e/.auth/admin.json`.
 *
 * A failed login does not abort the run: logged-out specs (health, login page) still run,
 * and authenticated specs fail fast with the recorded reason (see `e2e/support/fixtures.ts`).
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { ensureAdminStorageState, LOGGED_OUT_STATE } from './support/auth';
import { resolveChromium } from './support/browser';
import { ensureDevServer } from './support/dev-server';
import { ADMIN_STORAGE_STATE, AUTH_DIR } from './support/paths';

export default async function globalSetup(): Promise<void> {
  const log = (message: string) => process.stdout.write(`[global-setup] ${message}\n`);
  log(`browser: ${resolveChromium().source}`);

  const dev = await ensureDevServer({ log });
  log(`server ${dev.url} ${dev.startedServer ? 'started' : 'reused'} (version ${dev.health.version ?? '?'})`);

  const auth = await ensureAdminStorageState();
  if (auth.ok) {
    log(auth.reused ? 'reused saved admin session' : `logged in as ${auth.email}`);
    return;
  }
  log(`WARNING: admin login unavailable — authenticated specs will fail. ${auth.reason ?? ''}`);
  // Playwright needs the storageState file to exist even when login failed.
  if (!existsSync(ADMIN_STORAGE_STATE)) {
    await mkdir(AUTH_DIR, { recursive: true });
    await writeFile(ADMIN_STORAGE_STATE, JSON.stringify(LOGGED_OUT_STATE));
  }
}
