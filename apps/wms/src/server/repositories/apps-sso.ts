/**
 * Single sign-on (Apps › Single sign-on). OpenID Connect authorization-code flow with PKCE:
 *
 *   GET /api/auth/sso/start     → discovery (<issuer>/.well-known/openid-configuration), state +
 *                                 nonce + PKCE verifier sealed in a 10-minute httpOnly cookie,
 *                                 redirect to the provider's authorization endpoint.
 *   GET /api/auth/sso/callback  → state check, code exchange (client_secret_basic), ID token
 *                                 verified against the provider JWKS (issuer, audience, nonce,
 *                                 expiry), email → an active KitStak user, session issued.
 *
 * SAML 2.0 configs publish service-provider metadata (`/api/auth/sso/metadata`) and validate
 * the IdP certificate; sign-in itself uses the OIDC flow (every listed IdP offers both).
 * Users are never auto-created: the email must belong to an active user.
 */
import { X509Certificate, createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AppDb } from '@/server/api/db';
import { AppError } from '@/server/api/errors';
import * as s from '@/server/db/schema';
import { decryptCredentials, encryptCredentials } from '@/server/integrations/crypto';
import { appSecrets } from './apps';
import { dbGet } from '@/server/db/sql';

export const SSO_STATE_COOKIE = 'ks_sso';
export const SSO_STATE_TTL_SECONDS = 600;
export const SSO_CALLBACK_PATH = '/api/auth/sso/callback';

export interface SsoConfig {
  readonly active: boolean;
  readonly protocol: 'OpenID Connect' | 'SAML 2.0';
  readonly provider: string;
  readonly buttonLabel: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly entityId: string;
  readonly ssoUrl: string;
  readonly certificate: string;
  readonly allowedDomains: readonly string[];
  readonly enforce: boolean;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export async function getSsoConfig(db: AppDb): Promise<SsoConfig | null> {
  const row = (await db.select().from(s.apps).where(eq(s.apps.key, 'sso')).limit(1))[0];
  if (!row) return null;
  const st = (row.settings ?? {}) as Record<string, unknown>;
  const provider = str(st.provider) || 'your identity provider';
  return {
    active: Boolean(row.isActive),
    protocol: st.protocol === 'SAML 2.0' ? 'SAML 2.0' : 'OpenID Connect',
    provider,
    buttonLabel: str(st.buttonLabel) || `Sign in with ${provider === 'Other' ? 'SSO' : provider}`,
    issuer: str(st.issuer).replace(/\/+$/, ''),
    clientId: str(st.clientId),
    clientSecret: appSecrets(row).clientSecret ?? '',
    entityId: str(st.entityId),
    ssoUrl: str(st.ssoUrl),
    certificate: str(st.certificate),
    allowedDomains: str(st.allowedDomains)
      .split(',')
      .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean),
    enforce: Boolean(st.enforce),
  };
}

/** Public, unauthenticated view for the sign-in page. */
export async function ssoPublicStatus(
  db: AppDb,
): Promise<{ readonly enabled: boolean; readonly label: string | null; readonly enforced: boolean }> {
  const c = await getSsoConfig(db);
  const enabled = Boolean(c?.active && c.protocol === 'OpenID Connect' && c.issuer && c.clientId);
  return { enabled, label: enabled ? c!.buttonLabel : null, enforced: Boolean(enabled && c!.enforce) };
}

/** Password sign-in is refused for non-admins while SSO is active and enforced. */
export async function passwordLoginBlockedBySso(db: AppDb, userId: string): Promise<boolean> {
  if (!(await ssoPublicStatus(db)).enforced) return false;
  const admin =
    (
      await dbGet<{ n: number }>(
        db,
        sql`SELECT COUNT(*) AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ${userId} AND r.key = 'admin'`,
      )
    )?.n ?? 0;
  return Number(admin) === 0;
}

export function emailDomainAllowed(email: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  const domain = email.toLowerCase().split('@')[1] ?? '';
  return allowed.includes(domain);
}

interface Discovery {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
}

const discoveryCache = new Map<string, { at: number; doc: Discovery }>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function discover(issuer: string): Promise<Discovery> {
  const hit = discoveryCache.get(issuer);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.doc;
  let res: Response;
  try {
    res = await fetch(`${issuer}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(8000),
      headers: { accept: 'application/json' },
    });
  } catch (e) {
    throw new AppError(
      'INVALID_STATE',
      `Couldn't reach ${issuer} (${e instanceof Error ? e.message : 'network error'})`,
    );
  }
  if (!res.ok)
    throw new AppError('INVALID_STATE', `${issuer} answered ${res.status} for its OpenID configuration`);
  const doc = (await res.json()) as Partial<Discovery>;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri || !doc.issuer)
    throw new AppError('INVALID_STATE', 'The OpenID configuration is missing endpoints');
  const full = doc as Discovery;
  discoveryCache.set(issuer, { at: Date.now(), doc: full });
  return full;
}

const b64url = (b: Buffer) => b.toString('base64url');

export interface SsoStart {
  readonly redirectUrl: string;
  readonly cookie: string;
}

export async function startSso(db: AppDb, origin: string, returnTo: string | null): Promise<SsoStart> {
  const c = await getSsoConfig(db);
  if (!c?.active || c.protocol !== 'OpenID Connect' || !c.issuer || !c.clientId)
    throw new AppError('INVALID_STATE', "Single sign-on isn't set up");
  const d = await discover(c.issuer);
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    redirect_uri: `${origin}${SSO_CALLBACK_PATH}`,
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  const safeReturn = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
  return {
    redirectUrl: url.toString(),
    cookie: encryptCredentials({ state, nonce, verifier, returnTo: safeReturn, at: String(Date.now()) }),
  };
}

export interface SsoIdentity {
  readonly userId: string;
  readonly email: string;
  readonly returnTo: string;
  readonly subject: string;
}

export async function completeSso(
  db: AppDb,
  origin: string,
  params: URLSearchParams,
  cookie: string | undefined,
): Promise<SsoIdentity> {
  const c = await getSsoConfig(db);
  if (!c?.active || c.protocol !== 'OpenID Connect')
    throw new AppError('INVALID_STATE', "Single sign-on isn't active");
  const err = params.get('error');
  if (err)
    throw new AppError(
      'UNAUTHENTICATED',
      `${c.provider} returned: ${params.get('error_description') ?? err}`,
    );
  const saved = decryptCredentials(cookie);
  if (!saved || Date.now() - Number(saved.at ?? 0) > SSO_STATE_TTL_SECONDS * 1000)
    throw new AppError('UNAUTHENTICATED', 'The sign-in attempt expired. Try again.');
  if (!params.get('state') || params.get('state') !== saved.state)
    throw new AppError('UNAUTHENTICATED', "The sign-in response didn't match this browser. Try again.");
  const code = params.get('code');
  if (!code) throw new AppError('UNAUTHENTICATED', "The identity provider didn't return a code");
  const d = await discover(c.issuer);
  const tokenRes = await fetch(d.token_endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      authorization: `Basic ${Buffer.from(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.clientSecret)}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${origin}${SSO_CALLBACK_PATH}`,
      code_verifier: saved.verifier ?? '',
      client_id: c.clientId,
    }).toString(),
  });
  const tokens = (await tokenRes.json().catch(() => ({}))) as {
    id_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenRes.ok || !tokens.id_token)
    throw new AppError(
      'UNAUTHENTICATED',
      `Token exchange failed: ${tokens.error_description ?? tokens.error ?? tokenRes.status}`,
    );
  let jwks = jwksCache.get(d.jwks_uri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(d.jwks_uri));
    jwksCache.set(d.jwks_uri, jwks);
  }
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(tokens.id_token, jwks, {
      issuer: d.issuer,
      audience: c.clientId,
      clockTolerance: 60,
    }));
  } catch (e) {
    throw new AppError(
      'UNAUTHENTICATED',
      `The ID token didn't verify (${e instanceof Error ? e.message : 'invalid'})`,
    );
  }
  if (payload.nonce !== saved.nonce) throw new AppError('UNAUTHENTICATED', "The ID token nonce didn't match");
  const email = String(payload.email ?? payload.preferred_username ?? payload.upn ?? '')
    .trim()
    .toLowerCase();
  if (!email.includes('@'))
    throw new AppError(
      'UNAUTHENTICATED',
      "The identity provider didn't share an email address (add the email scope)",
    );
  if (payload.email_verified === false)
    throw new AppError('UNAUTHENTICATED', "Your email isn't verified at the identity provider");
  if (!emailDomainAllowed(email, c.allowedDomains))
    throw new AppError('FORBIDDEN', `${email.split('@')[1]} isn't an allowed sign-in domain`);
  const user = (
    await db
      .select({ id: s.users.id, isActive: s.users.isActive })
      .from(s.users)
      .where(sql`lower(${s.users.email}) = ${email}`)
      .limit(1)
  )[0];
  if (!user)
    throw new AppError(
      'FORBIDDEN',
      `No KitStak user has the email ${email}. Ask an administrator to add you.`,
    );
  if (!user.isActive) throw new AppError('FORBIDDEN', 'Your KitStak user is inactive');
  await db
    .update(s.users)
    .set({ lastLoginAt: new Date().toISOString(), failedLoginCount: 0, lockedUntil: null })
    .where(eq(s.users.id, user.id));
  return { userId: user.id, email, returnTo: saved.returnTo ?? '/', subject: String(payload.sub ?? '') };
}

/** Service-provider metadata for SAML 2.0 identity providers. */
export function samlMetadataXml(origin: string): string {
  const esc = (v: string) =>
    v.replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch] ?? ch);
  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${esc(`${origin}/api/auth/sso/metadata`)}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${esc(`${origin}/api/auth/sso/acs`)}" index="0" isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>
`;
}

export interface SsoTestResult {
  readonly ok: boolean;
  readonly checks: readonly { readonly label: string; readonly ok: boolean; readonly detail: string }[];
}

/** Gear panel "Test connection": OIDC discovery + JWKS, or the SAML certificate. */
export async function testSso(db: AppDb): Promise<SsoTestResult> {
  const c = await getSsoConfig(db);
  if (!c)
    return { ok: false, checks: [{ label: 'Configuration', ok: false, detail: 'Save the settings first' }] };
  const checks: { label: string; ok: boolean; detail: string }[] = [];
  if (c.protocol === 'OpenID Connect') {
    try {
      const d = await discover(c.issuer);
      checks.push({ label: 'OpenID configuration', ok: true, detail: d.issuer });
      try {
        const r = await fetch(d.jwks_uri, { signal: AbortSignal.timeout(8000) });
        const keys = ((await r.json()) as { keys?: unknown[] }).keys ?? [];
        checks.push({
          label: 'Signing keys (JWKS)',
          ok: keys.length > 0,
          detail: `${keys.length} key${keys.length === 1 ? '' : 's'}`,
        });
      } catch (e) {
        checks.push({
          label: 'Signing keys (JWKS)',
          ok: false,
          detail: e instanceof Error ? e.message : 'unreachable',
        });
      }
    } catch (e) {
      checks.push({
        label: 'OpenID configuration',
        ok: false,
        detail: e instanceof Error ? e.message : 'unreachable',
      });
    }
    checks.push({ label: 'Client ID', ok: c.clientId.length > 0, detail: c.clientId || 'Missing' });
    checks.push({
      label: 'Client secret',
      ok: c.clientSecret.length > 0,
      detail: c.clientSecret ? `••••${c.clientSecret.slice(-4)}` : 'Missing',
    });
  } else {
    try {
      const pem = c.certificate.includes('BEGIN CERTIFICATE')
        ? c.certificate
        : `-----BEGIN CERTIFICATE-----\n${c.certificate.replace(/\s+/g, '')}\n-----END CERTIFICATE-----`;
      const cert = new X509Certificate(pem);
      const expired = new Date(cert.validTo) < new Date();
      checks.push({
        label: 'Signing certificate',
        ok: !expired,
        detail: `${cert.subject.split('\n').find((l) => l.startsWith('CN=')) ?? cert.subject} · valid to ${new Date(cert.validTo).toISOString().slice(0, 10)}${expired ? ' (expired)' : ''}`,
      });
    } catch {
      checks.push({ label: 'Signing certificate', ok: false, detail: 'Not a valid X.509 certificate' });
    }
    checks.push({
      label: 'Single sign-on URL',
      ok: /^https:\/\//.test(c.ssoUrl),
      detail: c.ssoUrl || 'Missing',
    });
  }
  return { ok: checks.every((x) => x.ok), checks };
}
