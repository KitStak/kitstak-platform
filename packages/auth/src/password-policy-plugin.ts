/**
 * Better Auth plugin porting WMS's password policy + account lockout (blueprint §1.1):
 * `apps/wms/src/server/auth/password-policy.ts` (policy validation, 72-byte bcrypt rule)
 * and the lockout semantics of `apps/wms/src/server/auth/login.ts` (threshold 5 → lock
 * 15 min by default, lock resets the counter, a failure that lost the race to a lockout
 * does not touch the state, success clears the state).
 *
 * The policy source is injected (`loadPolicy`): WMS passes a loader reading
 * `wms.company_settings.password_policy`; CRM passes nothing and gets defaults. Audit
 * emission is injected too (`onAuditEvent`). Lockout state lives in the plugin's own
 * `passwordPolicyState` model (core-schema-agnostic; persisted through the Better Auth
 * adapter, so the table is generated with the rest of the auth schema).
 */
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';

/** bcrypt only uses the first 72 bytes; longer inputs are rejected by the policy. */
export const MAX_PASSWORD_BYTES = 72;
export const DEFAULT_LOCKOUT_THRESHOLD = 5;
export const DEFAULT_LOCKOUT_MINUTES = 15;

export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
export const LOCKED_MESSAGE =
  'This account is temporarily locked after too many failed attempts. Try again later.';

export interface PasswordPolicy {
  readonly minLength: number;
  readonly requireUpper: boolean;
  readonly requireNumber: boolean;
  readonly requireSymbol: boolean;
  readonly maxAgeDays?: number;
  readonly lockoutThreshold: number;
  readonly lockoutMinutes: number;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 10,
  requireUpper: true,
  requireNumber: true,
  requireSymbol: true,
  lockoutThreshold: DEFAULT_LOCKOUT_THRESHOLD,
  lockoutMinutes: DEFAULT_LOCKOUT_MINUTES,
};

export interface PasswordContext {
  readonly email?: string;
  readonly name?: string;
}

/** Returns human-readable violations (empty when the password is acceptable). */
export function validatePassword(
  password: string,
  policy: PasswordPolicy,
  context: PasswordContext = {},
): readonly string[] {
  const issues: string[] = [];
  if (password.length < policy.minLength) issues.push(`Use at least ${policy.minLength} characters.`);
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES)
    issues.push(`Use at most ${MAX_PASSWORD_BYTES} bytes.`);
  if (policy.requireUpper && !/[A-Z]/.test(password)) issues.push('Include an uppercase letter.');
  if (policy.requireUpper && !/[a-z]/.test(password)) issues.push('Include a lowercase letter.');
  if (policy.requireNumber && !/[0-9]/.test(password)) issues.push('Include a number.');
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) issues.push('Include a symbol.');
  const lowered = password.toLowerCase();
  const localPart = context.email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 3 && lowered.includes(localPart))
    issues.push('Do not include your email name.');
  return issues;
}

/** True when the password is older than `maxAgeDays` (no max age → never expires). */
export function isPasswordExpired(
  passwordChangedAt: string | null,
  policy: PasswordPolicy,
  now: Date = new Date(),
): boolean {
  if (!policy.maxAgeDays || !passwordChangedAt) return false;
  return now.getTime() - Date.parse(passwordChangedAt) > policy.maxAgeDays * 86_400_000;
}

/** Lockout deadline after a failed attempt, or null while under the threshold. */
export function lockoutUntil(
  failedCount: number,
  policy: PasswordPolicy,
  now: Date = new Date(),
): string | null {
  return failedCount >= policy.lockoutThreshold
    ? new Date(now.getTime() + policy.lockoutMinutes * 60_000).toISOString()
    : null;
}

export interface PasswordPolicyAuditEvent {
  readonly action: 'auth.login' | 'auth.password.rejected';
  readonly outcome: 'success' | 'failure';
  readonly email: string;
  readonly userId: string | null;
  readonly reason?: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** Sparse policy loader; missing keys fall back to `DEFAULT_PASSWORD_POLICY`. */
export type PasswordPolicyLoader = () => Partial<PasswordPolicy> | Promise<Partial<PasswordPolicy>>;

export interface PasswordPolicyPluginOptions {
  /** Injected policy source (WMS: company settings loader). Omitted → defaults. */
  readonly loadPolicy?: PasswordPolicyLoader;
  /** Injected audit sink (WMS: `audit_log` writer). Failures here never block auth. */
  readonly onAuditEvent?: (event: PasswordPolicyAuditEvent) => void | Promise<void>;
  /** Clock override for tests. */
  readonly now?: () => Date;
}

/** Lockout state row persisted via the Better Auth adapter (plugin-owned model). */
interface PasswordPolicyState {
  readonly id: string;
  readonly email: string;
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | string | null;
}

/** Minimal structural view of the Better Auth adapter (keeps us version-tolerant). */
interface PolicyAdapter {
  findOne: <T>(args: {
    model: string;
    where: { field: string; value: string; operator?: string; connector?: string }[];
  }) => Promise<T | null>;
  create: <T extends Record<string, unknown>, R = T>(args: {
    model: string;
    data: T;
    forceAllowId?: boolean;
  }) => Promise<R>;
  update: <T>(args: {
    model: string;
    where: { field: string; value: string; operator?: string; connector?: string }[];
    update: Record<string, unknown>;
  }) => Promise<T | null>;
}

const STATE_MODEL = 'passwordPolicyState';

function normalizeEmail(email: unknown): string | null {
  return typeof email === 'string' && email.length > 0 ? email.trim().toLowerCase() : null;
}

function toTime(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

async function resolvePolicy(loadPolicy: PasswordPolicyLoader | undefined): Promise<PasswordPolicy> {
  if (!loadPolicy) return DEFAULT_PASSWORD_POLICY;
  try {
    const partial = await loadPolicy();
    return { ...DEFAULT_PASSWORD_POLICY, ...partial };
  } catch {
    return DEFAULT_PASSWORD_POLICY; // invalid/unavailable policy falls back to defaults (WMS behavior)
  }
}

function findState(adapter: PolicyAdapter, email: string): Promise<PasswordPolicyState | null> {
  return adapter.findOne<PasswordPolicyState>({
    model: STATE_MODEL,
    where: [{ field: 'email', value: email }],
  });
}

/**
 * Counts a failed attempt. Mirrors WMS `registerFailure`: the count is re-read first, and
 * an attempt that lost the race to a lockout does not touch the row (it must not clear
 * `lockedUntil`); reaching the threshold resets the counter and sets the deadline.
 */
async function registerFailure(
  adapter: PolicyAdapter,
  email: string,
  policy: PasswordPolicy,
  now: Date,
): Promise<void> {
  const state = await findState(adapter, email);
  const lockedTime = toTime(state?.lockedUntil);
  if (lockedTime !== null && lockedTime > now.getTime()) return;
  const failedLoginCount = (state?.failedLoginCount ?? 0) + 1;
  const locked = lockoutUntil(failedLoginCount, policy, now);
  const update = {
    failedLoginCount: locked ? 0 : failedLoginCount,
    lockedUntil: locked ? new Date(locked) : null,
  };
  if (state) {
    await adapter.update({ model: STATE_MODEL, where: [{ field: 'email', value: email }], update });
  } else {
    await adapter.create({ model: STATE_MODEL, data: { email, ...update } });
  }
}

async function clearFailures(adapter: PolicyAdapter, email: string): Promise<void> {
  const state = await findState(adapter, email);
  if (!state || (state.failedLoginCount === 0 && !state.lockedUntil)) return;
  await adapter.update({
    model: STATE_MODEL,
    where: [{ field: 'email', value: email }],
    update: { failedLoginCount: 0, lockedUntil: null },
  });
}

/** Paths whose request body carries a new password the policy must approve. */
const NEW_PASSWORD_PATHS: Record<string, 'password' | 'newPassword'> = {
  '/sign-up/email': 'password',
  '/change-password': 'newPassword',
  '/reset-password': 'newPassword',
};

export function passwordPolicyPlugin(options: PasswordPolicyPluginOptions = {}) {
  const now = options.now ?? (() => new Date());

  const emitAudit = async (event: PasswordPolicyAuditEvent): Promise<void> => {
    if (!options.onAuditEvent) return;
    try {
      await options.onAuditEvent(event);
    } catch {
      // Audit sinks must never block or fail authentication.
    }
  };

  const requestMeta = (headers: Headers | undefined): { ip: string | null; userAgent: string | null } => ({
    ip: headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: headers?.get('user-agent') ?? null,
  });

  return {
    id: 'kitstak-password-policy',
    schema: {
      passwordPolicyState: {
        modelName: 'password_policy_state',
        fields: {
          // camelCase field names, like the core models: the Drizzle adapter resolves
          // them against the schema table's TS property keys (whose DB columns are
          // snake_case — packages/db schema/core/auth-policy.ts).
          email: { type: 'string', required: true, unique: true },
          failedLoginCount: { type: 'number', required: true, defaultValue: 0 },
          lockedUntil: { type: 'date', required: false },
        },
      },
    },
    hooks: {
      before: [
        {
          // Lockout gate: a locked account is rejected before credentials are even checked
          // (WMS returned `locked` regardless of password correctness).
          matcher: (ctx) => ctx.path === '/sign-in/email',
          handler: createAuthMiddleware(async (ctx) => {
            const body = (ctx.body ?? {}) as { email?: unknown };
            const email = normalizeEmail(body.email);
            if (!email) return;
            const adapter = ctx.context.adapter as unknown as PolicyAdapter;
            const state = await findState(adapter, email);
            const lockedTime = toTime(state?.lockedUntil);
            if (lockedTime !== null && lockedTime > now().getTime()) {
              await emitAudit({
                action: 'auth.login',
                outcome: 'failure',
                email,
                userId: null,
                reason: 'locked',
                ...requestMeta(ctx.headers),
              });
              throw new APIError('UNAUTHORIZED', { message: LOCKED_MESSAGE, code: 'ACCOUNT_LOCKED' });
            }
          }),
        },
        {
          // Policy gate: every path that sets a new password must satisfy the injected
          // policy, including the 72-byte bcrypt rule.
          matcher: (ctx) => ctx.path !== undefined && ctx.path in NEW_PASSWORD_PATHS,
          handler: createAuthMiddleware(async (ctx) => {
            const field = ctx.path ? NEW_PASSWORD_PATHS[ctx.path] : undefined;
            if (!field) return;
            const body = (ctx.body ?? {}) as Record<string, unknown>;
            const password = body[field];
            if (typeof password !== 'string') return; // core validation rejects missing passwords
            const sessionUser = ctx.context.session?.user as { email?: string; name?: string } | undefined;
            const context: PasswordContext = {
              email: normalizeEmail(body.email) ?? sessionUser?.email,
              name: typeof body.name === 'string' ? body.name : sessionUser?.name,
            };
            const policy = await resolvePolicy(options.loadPolicy);
            const issues = validatePassword(password, policy, context);
            if (issues.length === 0) return;
            await emitAudit({
              action: 'auth.password.rejected',
              outcome: 'failure',
              email: context.email ?? '',
              userId: null,
              reason: issues.join(' '),
              ...requestMeta(ctx.headers),
            });
            throw new APIError('BAD_REQUEST', {
              message: issues.join(' '),
              code: 'PASSWORD_POLICY',
              issues,
            });
          }),
        },
      ],
      after: [
        {
          // Outcome tracking: failures count toward lockout (only for existing users,
          // like WMS — unknown emails audit but never create state rows); success clears
          // the counter and deadline.
          matcher: (ctx) => ctx.path === '/sign-in/email',
          handler: createAuthMiddleware(async (ctx) => {
            const body = (ctx.body ?? {}) as { email?: unknown };
            const email = normalizeEmail(body.email);
            if (!email) return;
            const adapter = ctx.context.adapter as unknown as PolicyAdapter;
            const meta = requestMeta(ctx.headers);
            const returned = ctx.context.returned;
            if (returned instanceof Error) {
              if (returned instanceof APIError && returned.body?.code === 'ACCOUNT_LOCKED') return;
              const user = await adapter.findOne<{ id: string }>({
                model: 'user',
                where: [{ field: 'email', value: email }],
              });
              if (!user) {
                await emitAudit({
                  action: 'auth.login',
                  outcome: 'failure',
                  email,
                  userId: null,
                  reason: 'unknown_email',
                  ...meta,
                });
                return;
              }
              const policy = await resolvePolicy(options.loadPolicy);
              await registerFailure(adapter, email, policy, now());
              await emitAudit({
                action: 'auth.login',
                outcome: 'failure',
                email,
                userId: user.id,
                reason: 'invalid_credentials',
                ...meta,
              });
              return;
            }
            await clearFailures(adapter, email);
            const userId =
              returned && typeof returned === 'object' && 'user' in returned
                ? ((returned as { user?: { id?: string } }).user?.id ?? null)
                : null;
            await emitAudit({ action: 'auth.login', outcome: 'success', email, userId, ...meta });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
