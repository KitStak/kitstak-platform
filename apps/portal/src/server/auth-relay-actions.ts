'use server';
/**
 * Sign in, sign up and "invite a teammate" as server actions (docs/billing/SPEC.md section 13: no
 * console errors on a normal path).
 *
 * A wrong password, an email that already has an account, a bad invite address and "all seats are
 * in use" are expected answers, not failures. When the browser calls the auth endpoints itself, each
 * of them comes back as 401, 422, 400 or 403 and the browser prints "Failed to load resource" in
 * the console. Here the browser calls a server action, which always answers 200 with a plain
 * result, so the console stays clean and the form shows the sentence.
 *
 * Nothing about the rules changes. Each action hands a real request to the SAME Better Auth
 * handler the `/api/auth/*` route uses, with the caller's own cookies, origin and address. The
 * rate limits, the password policy, the lockout, the seat check and every other hook run exactly
 * as they do for a direct call, and the session cookie is set by the same code. Only these three
 * endpoints can be reached through this file.
 */
import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { env } from '@/server/env';

export interface AuthRelayResult {
  readonly ok: boolean;
  /** The auth endpoint's own answer, kept for the form's error words. null on success. */
  readonly error: { readonly code?: string; readonly message?: string; readonly status: number } | null;
}

/** The request headers the auth layer reads: who is calling, from where, and with which session. */
const FORWARDED_HEADERS = [
  'cookie',
  'origin',
  'referer',
  'user-agent',
  'accept-language',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'x-vercel-forwarded-for',
  'x-vercel-ip-country',
  'cf-connecting-ip',
] as const;

/**
 * Hands the auth handler's cookies (the session, the cached session data) to the browser. The
 * handler answered a request this action made on the server, so its `Set-Cookie` lines have to be
 * copied onto the action's own response. Every attribute is kept as the auth layer set it.
 */
async function forwardCookies(response: Response): Promise<void> {
  const lines = response.headers.getSetCookie();
  if (lines.length === 0) return;
  const jar = await cookies();
  for (const line of lines) {
    const [pair, ...attributes] = line.split(';');
    const cut = (pair ?? '').indexOf('=');
    if (cut <= 0) continue;
    const name = (pair ?? '').slice(0, cut).trim();
    const raw = (pair ?? '').slice(cut + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      // Not encoded. Keep it as it is.
    }
    const options: {
      path?: string;
      domain?: string;
      maxAge?: number;
      expires?: Date;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: 'lax' | 'strict' | 'none';
      partitioned?: boolean;
    } = {};
    for (const attribute of attributes) {
      const at = attribute.indexOf('=');
      const key = (at === -1 ? attribute : attribute.slice(0, at)).trim().toLowerCase();
      const val = at === -1 ? '' : attribute.slice(at + 1).trim();
      if (key === 'path') options.path = val;
      else if (key === 'domain') options.domain = val;
      else if (key === 'max-age' && /^-?\d+$/.test(val)) options.maxAge = Number(val);
      else if (key === 'expires' && !Number.isNaN(Date.parse(val))) options.expires = new Date(val);
      else if (key === 'httponly') options.httpOnly = true;
      else if (key === 'secure') options.secure = true;
      else if (key === 'partitioned') options.partitioned = true;
      else if (key === 'samesite') {
        const mode = val.toLowerCase();
        if (mode === 'lax' || mode === 'strict' || mode === 'none') options.sameSite = mode;
      }
    }
    jar.set(name, value, options);
  }
}

type RelayPath = '/sign-in/email' | '/sign-up/email' | '/organization/invite-member';

async function relay(path: RelayPath, body: Record<string, unknown>): Promise<AuthRelayResult> {
  const incoming = await headers();
  const forwarded = new Headers({ 'content-type': 'application/json' });
  for (const name of FORWARDED_HEADERS) {
    const value = incoming.get(name);
    if (value) forwarded.set(name, value);
  }
  let response: Response;
  try {
    const url = new URL(`/api/auth${path}`, env.BETTER_AUTH_URL);
    response = await auth.handler(new Request(url, { method: 'POST', headers: forwarded, body: JSON.stringify(body) }));
  } catch (error: unknown) {
    console.error(`[portal] auth relay failed (${path})`, error instanceof Error ? error.message : error);
    return { ok: false, error: { status: 500 } };
  }
  await forwardCookies(response);
  if (response.ok) return { ok: true, error: null };
  let payload: { code?: unknown; message?: unknown } = {};
  try {
    payload = (await response.json()) as { code?: unknown; message?: unknown };
  } catch {
    // An answer with no body still has its status.
  }
  return {
    ok: false,
    error: {
      status: response.status,
      ...(typeof payload.code === 'string' ? { code: payload.code } : {}),
      ...(typeof payload.message === 'string' ? { message: payload.message } : {}),
    },
  };
}

const BAD_INPUT: AuthRelayResult = { ok: false, error: { status: 400, code: 'INVALID_INPUT', message: 'Check what you entered and try again.' } };

const signInSchema = z.object({
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(200),
  rememberMe: z.boolean().optional(),
});

export async function signInAction(input: unknown): Promise<AuthRelayResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return BAD_INPUT;
  return relay('/sign-in/email', parsed.data);
}

const signUpSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(200),
  timezone: z.string().max(100).optional(),
});

export async function signUpAction(input: unknown): Promise<AuthRelayResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) return BAD_INPUT;
  return relay('/sign-up/email', parsed.data);
}

const inviteSchema = z.object({
  email: z.string().min(1).max(320),
  role: z.enum(['admin', 'member', 'viewer']),
  organizationId: z.string().min(1).max(100),
});

export async function inviteMemberAction(input: unknown): Promise<AuthRelayResult> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return BAD_INPUT;
  return relay('/organization/invite-member', parsed.data);
}
