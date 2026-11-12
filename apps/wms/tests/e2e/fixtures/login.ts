/**
 * API login used by the auth setup project and by fixtures that need a fresh
 * session. Goes through Better Auth's POST /api/auth/sign-in/email (the same
 * endpoint the login form uses) so the `kitstak.session_token` cookie lands in
 * the request context's cookie jar (blueprint §1.4).
 */
import type { APIRequestContext } from '@playwright/test';
import { ROLE_EMAILS, e2eBaseUrl, e2ePassword, type Role } from './roles';

const MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_AFTER_S = 5;
const MAX_RETRY_WAIT_S = 65;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function parseRetryAfter(header: string | undefined): number {
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_RETRY_AFTER_S;
  return Math.min(seconds, MAX_RETRY_WAIT_S);
}

export async function loginViaApi(request: APIRequestContext, role: Role): Promise<void> {
  const baseUrl = e2eBaseUrl();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await request.post(`${baseUrl}/api/auth/sign-in/email`, {
      data: { email: ROLE_EMAILS[role], password: e2ePassword() },
      // Same-origin headers so Better Auth's trusted-origin check accepts the request.
      headers: { Origin: baseUrl, Referer: `${baseUrl}/login` },
    });
    if (response.ok()) return;
    if (response.status() === 429 && attempt < MAX_ATTEMPTS) {
      await sleep(parseRetryAfter(response.headers()['retry-after']) * 1000);
      continue;
    }
    const body = await response.text();
    throw new Error(`Login as ${role} failed: HTTP ${response.status()} ${body.slice(0, 300)}`);
  }
  throw new Error(`Login as ${role} failed: rate limited after ${MAX_ATTEMPTS} attempts`);
}
