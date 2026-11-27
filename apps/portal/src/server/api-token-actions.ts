'use server';
/**
 * Settings, API tokens (docs/integration/AGENT_WRITE_API.md W1 to W3): make and revoke platform
 * API tokens. A person makes tokens for themselves only, in the organization they are working in,
 * for the apps that organization has. Making one needs a sign in from the last 15 minutes, like
 * setting a password. The person and org owners and admins can revoke a token.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { enforceRateLimit } from '@kitstak/billing/server';
import { ApiTokenError, createApiToken, revokeApiToken, type ApiTokenSummary } from '@kitstak/db/api-tokens';
import { isFreshSession } from '@/server/account';
import { db } from '@/server/db';
import { getOrgModuleStates } from '@/server/entitlements';
import { resolveActiveOrg } from '@/server/orgs';
import { getSession } from '@/server/session';
import { TOKEN_APPS, isTokenManager, scopesFor, type TokenApp } from '@/features/api-tokens/token-model';

export interface ApiTokenActionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly field?: 'name' | 'apps' | 'days';
  readonly code?: 'sign_in_again';
  /** The new token, shown once. Only on a successful create. */
  readonly token?: string;
  readonly record?: ApiTokenSummary;
}

const PAGE = '/settings/api-tokens';
const SIGN_IN_AGAIN = 'Please sign in again.';
const TOO_MANY_TRIES = 'Too many tries. Wait 10 minutes and try again.';

function fail(error: string, extra: Partial<ApiTokenActionResult> = {}): ApiTokenActionResult {
  return { ok: false, error, ...extra };
}

const FORM_FIELD: Readonly<Record<NonNullable<ApiTokenError['field']>, NonNullable<ApiTokenActionResult['field']>>> = {
  name: 'name',
  scopes: 'apps',
  days: 'days',
};

function fieldOf(error: ApiTokenError): ApiTokenActionResult['field'] {
  return error.field ? FORM_FIELD[error.field] : undefined;
}

const createSchema = z.object({
  name: z.string().max(200),
  apps: z.array(z.enum(TOKEN_APPS)).max(TOKEN_APPS.length),
  access: z.enum(['read', 'write']),
  days: z.number().int(),
});

/** Makes a token for the signed in person in their current organization. */
export async function createApiTokenAction(input: unknown): Promise<ApiTokenActionResult> {
  const session = await getSession();
  if (!session) return fail(SIGN_IN_AGAIN);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail('Some fields need another look.');
  const { name, access, days } = parsed.data;
  const apps = [...new Set(parsed.data.apps)];
  if (apps.length === 0) return fail('Pick at least one app.', { field: 'apps' });
  // First, before reading anything about the organization: an old session learns nothing here.
  if (!isFreshSession(session.session.createdAt)) {
    return fail('To keep your account safe, sign in again first. Then make the token.', { code: 'sign_in_again' });
  }

  const org = await resolveActiveOrg(session);
  if (!org) return fail('Join an organization first.');
  const { modules } = await getOrgModuleStates(org.id);
  const offered = new Set<TokenApp>(modules.filter((m) => m.entitled && (TOKEN_APPS as readonly string[]).includes(m.module)).map((m) => m.module as TokenApp));
  const missing = apps.filter((app) => !offered.has(app));
  if (missing.length > 0) return fail('Your plan does not include every app you picked.', { field: 'apps' });
  if (!(await enforceRateLimit(db, { key: `portal:api-token:create:${session.user.id}`, windowSeconds: 600, max: 10 }))) {
    return fail(TOO_MANY_TRIES);
  }

  try {
    const made = await createApiToken(db, { orgId: org.id, userId: session.user.id, name, scopes: scopesFor(apps, access), days });
    revalidatePath(PAGE);
    return { ok: true, token: made.token, record: made.record };
  } catch (error: unknown) {
    if (error instanceof ApiTokenError) return fail(error.message, { field: fieldOf(error) });
    console.error('[portal] createApiTokenAction failed', error);
    return fail('We could not make the token. Try again.');
  }
}

const revokeSchema = z.object({ tokenId: z.string().uuid() });

/** Revokes a token in the current organization: your own, or anyone's when you own or run it. */
export async function revokeApiTokenAction(input: unknown): Promise<ApiTokenActionResult> {
  const session = await getSession();
  if (!session) return fail(SIGN_IN_AGAIN);
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return fail('That token is not in this organization.');
  const org = await resolveActiveOrg(session);
  if (!org) return fail('Join an organization first.');
  if (!(await enforceRateLimit(db, { key: `portal:api-token:revoke:${session.user.id}`, windowSeconds: 600, max: 60 }))) {
    return fail(TOO_MANY_TRIES);
  }
  try {
    await revokeApiToken(db, { orgId: org.id, tokenId: parsed.data.tokenId, actorId: session.user.id, actorIsManager: isTokenManager(org.role) });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (error: unknown) {
    if (error instanceof ApiTokenError) return fail(error.message);
    console.error('[portal] revokeApiTokenAction failed', error);
    return fail('We could not revoke the token. Try again.');
  }
}
