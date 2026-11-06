/**
 * Demo-admin session management shared by Playwright global setup and the screenshot CLI.
 *
 * Logs in through Better Auth's JSON endpoint (independent of the login UI), saves the
 * Playwright storage state to `e2e/.auth/admin.json`, and reuses it while the session is
 * still valid so concurrent critics don't hammer the rate-limited sign-in route.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { request, type APIRequestContext } from '@playwright/test';
import { loadCredentials } from './credentials';
import { withLock } from './lockfile';
import { ADMIN_AUTH_STATUS, ADMIN_STORAGE_STATE, AUTH_DIR, AUTH_LOCK_FILE, baseUrl } from './paths';

export interface AuthStatus {
  readonly ok: boolean;
  readonly email?: string;
  readonly reused?: boolean;
  readonly reason?: string;
  readonly at: string;
}

interface SessionPayload {
  readonly user?: { readonly id?: string; readonly email?: string } | null;
}

async function newContext(storageState?: string): Promise<APIRequestContext> {
  const origin = baseUrl();
  return request.newContext({
    baseURL: origin,
    // Mutating requests must carry a trusted Origin (proxy + Better Auth both check it).
    extraHTTPHeaders: { origin },
    ...(storageState ? { storageState } : {}),
  });
}

/** True when the saved storage state still maps to a live session. */
export async function hasValidSession(file: string = ADMIN_STORAGE_STATE): Promise<boolean> {
  if (!existsSync(file)) return false;
  const context = await newContext(file);
  try {
    const response = await context.get('/api/auth/get-session', { timeout: 30_000 });
    if (!response.ok()) return false;
    const body = (await response.json().catch(() => null)) as SessionPayload | null;
    return typeof body?.user?.id === 'string';
  } catch {
    return false;
  } finally {
    await context.dispose();
  }
}

async function readError(response: Awaited<ReturnType<APIRequestContext['post']>>): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { message?: string; error?: { message?: string } | string };
    const nested = typeof body.error === 'string' ? body.error : body.error?.message;
    return body.message ?? nested ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300) || response.statusText();
  }
}

async function signInAndSave(file: string): Promise<string> {
  const credentials = loadCredentials();
  const context = await newContext();
  try {
    const response = await context.post('/api/auth/sign-in/email', {
      data: { email: credentials.email, password: credentials.password, rememberMe: true },
      timeout: 60_000,
    });
    if (!response.ok()) {
      const reason = await readError(response);
      const hint =
        response.status() === 401 || response.status() === 400
          ? ' Has the database been seeded? Run `npm run db:seed`.'
          : response.status() === 429
            ? ' Sign-in is rate limited; wait a minute and retry.'
            : '';
      throw new Error(
        `Demo login failed for ${credentials.email} (HTTP ${response.status()}): ${reason}.${hint} ` +
          `(credentials from ${credentials.source})`,
      );
    }
    await mkdir(AUTH_DIR, { recursive: true });
    await context.storageState({ path: file });
    return credentials.email;
  } finally {
    await context.dispose();
  }
}

async function writeStatus(status: AuthStatus): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true });
  await writeFile(ADMIN_AUTH_STATUS, JSON.stringify(status, null, 2));
}

export interface EnsureAuthOptions {
  /** Ignore a still-valid saved session and log in again. */
  readonly force?: boolean;
}

/**
 * Make sure `e2e/.auth/admin.json` holds a valid demo-admin session. Serialised with a
 * lockfile so concurrent callers log in at most once.
 */
export async function ensureAdminStorageState(options: EnsureAuthOptions = {}): Promise<AuthStatus> {
  if (!options.force && (await hasValidSession())) {
    return { ok: true, reused: true, at: new Date().toISOString() };
  }
  return withLock(
    AUTH_LOCK_FILE,
    { purpose: 'demo admin login', timeoutMs: 120_000, staleMs: 120_000 },
    async () => {
      // Someone else may have logged in while we waited for the lock.
      if (!options.force && (await hasValidSession())) {
        return { ok: true, reused: true, at: new Date().toISOString() };
      }
      try {
        const email = await signInAndSave(ADMIN_STORAGE_STATE);
        const status: AuthStatus = { ok: true, email, reused: false, at: new Date().toISOString() };
        await writeStatus(status);
        return status;
      } catch (error) {
        const status: AuthStatus = {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
          at: new Date().toISOString(),
        };
        await writeStatus(status);
        return status;
      }
    },
  );
}

/** An empty storage state, for tests that must run logged out. */
export const LOGGED_OUT_STATE = { cookies: [] as never[], origins: [] as never[] };
