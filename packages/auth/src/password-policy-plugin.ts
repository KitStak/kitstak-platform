/**
 * Better Auth plugin porting WMS's password policy + account lockout (blueprint §1.1):
 * `apps/wms/src/server/auth/password-policy.ts` (policy validation, 72-byte bcrypt rule)
 * and the lockout semantics of `apps/wms/src/server/auth/login.ts` (threshold 5 → lock
 * 15 min by default, lock resets the counter, a failure that lost the race to a lockout
 * does not touch the state, success clears the state).
 *
 * Lockout accounting covers `/sign-in/email` AND `/change-password` (auth review
 * 2026-11-11, M3 residual): change-password verifies the CURRENT password, so on an
 * instance that serves it (CRM) it is a credential oracle exactly like sign-in. Failed
 * current-password attempts increment the same per-email state — keyed on the SIGNED-IN
 * user's email from the session, never the request body — and a locked account's
 * `/change-password` is rejected with the same generic message as sign-in.
 *
 * The policy source is injected (`loadPolicy`): WMS passes a loader reading
 * `wms.company_settings.password_policy`; CRM passes nothing and gets defaults. Audit
 * emission is injected too (`onAuditEvent`). Lockout state lives in the plugin's own
 * `passwordPolicyState` model (core-schema-agnostic; persisted through the Better Auth
 * adapter, so the table is generated with the rest of the auth schema).
 */
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { sql } from 'drizzle-orm';
import { burnDummyPasswordVerify } from './timing';
import { weakPasswordMessage } from './weak-passwords';

/** bcrypt only uses the first 72 bytes; longer inputs are rejected by the policy. */
export const MAX_PASSWORD_BYTES = 72;
export const DEFAULT_LOCKOUT_THRESHOLD = 5;
export const DEFAULT_LOCKOUT_MINUTES = 15;

/**
 * The ONLY message a failed sign-in ever shows, locked accounts included: a distinct
 * "account locked" response would confirm the account exists and that the lockout
 * threshold was reached (auth review 2026-11-11, M5). The specific reason goes to the
 * injected audit sink only.
 */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
/** Error code matching Better Auth's own invalid-credentials response (no oracle). */
export const INVALID_CREDENTIALS_CODE = 'INVALID_EMAIL_OR_PASSWORD';

/** Internal marker so the after-hook can tell a lockout rejection from a real bad password. */
const LOCKOUT_REJECTION = Symbol('kitstak-lockout-rejection');

function isLockoutRejection(error: unknown): boolean {
  return typeof error === 'object' && error !== null && LOCKOUT_REJECTION in error;
}

export interface PasswordPolicy {
  readonly minLength: number;
  readonly requireUpper: boolean;
  readonly requireNumber: boolean;
  readonly requireSymbol: boolean;
  /**
   * A password of this many characters or more needs no capital, number or symbol: its length does
   * the work (billing review round 2; the same idea as NIST SP 800-63B). Shorter passwords still
   * follow the three `require*` rules. Leave it out to apply those rules to every length.
   */
  readonly passphraseLength?: number;
  readonly maxAgeDays?: number;
  readonly lockoutThreshold: number;
  readonly lockoutMinutes: number;
}

/** "correct horse battery staple" is a good password. From this length on, no other rule applies. */
export const DEFAULT_PASSPHRASE_LENGTH = 15;

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 10,
  requireUpper: true,
  requireNumber: true,
  requireSymbol: true,
  passphraseLength: DEFAULT_PASSPHRASE_LENGTH,
  lockoutThreshold: DEFAULT_LOCKOUT_THRESHOLD,
  lockoutMinutes: DEFAULT_LOCKOUT_MINUTES,
};

export interface PasswordContext {
  readonly email?: string;
  readonly name?: string;
  /** The person's own company. A password built around it is refused, like one built around `kitstak`. */
  readonly company?: string;
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
  // Long enough to stand by itself: no capital, number or symbol is asked for.
  const passphrase =
    typeof policy.passphraseLength === 'number' &&
    policy.passphraseLength >= policy.minLength &&
    password.length >= policy.passphraseLength;
  if (!passphrase) {
    if (policy.requireUpper && !/[A-Z]/.test(password)) issues.push('Include an uppercase letter.');
    if (policy.requireUpper && !/[a-z]/.test(password)) issues.push('Include a lowercase letter.');
    if (policy.requireNumber && !/[0-9]/.test(password)) issues.push('Include a number.');
    if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) issues.push('Include a symbol.');
  }
  const lowered = password.toLowerCase();
  const localPart = context.email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 3 && lowered.includes(localPart))
    issues.push('Do not include your email name.');
  // Length is not strength by itself (billing review round 3): `passwordpassword`, one character
  // held down, `123456789012345`, `qwertyuiopasdfgh`, a common password dressed up with digits, and
  // anything built around the product or company name are refused at every length. Said only when
  // nothing else is wrong, so a person fixes one clear thing at a time.
  // The line names the cause when the cause is a name (review round 4): "Do not use your company
  // name in your password." The form says the same words while the person types.
  const weak = issues.length === 0 ? weakPasswordMessage(password, { names: [context.company] }) : null;
  if (weak) issues.push(weak);
  return issues;
}

/** Code returned when `/change-password` is asked to keep the current password. */
export const PASSWORD_UNCHANGED_CODE = 'PASSWORD_UNCHANGED';
export const PASSWORD_UNCHANGED_MESSAGE = 'Choose a password that is different from your current one.';

/**
 * True when a change-password request would keep the same password. Without this, a user
 * who has been told to replace an administrator-set password could "change" it to itself.
 */
export function isUnchangedPassword(currentPassword: unknown, newPassword: unknown): boolean {
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') return false;
  // Compare the normalized forms: the same password typed with composed and decomposed
  // Unicode characters must not count as a change.
  return currentPassword.normalize('NFKC') === newPassword.normalize('NFKC');
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

/**
 * Minimal raw-SQL seam (a Drizzle db handle has it). When present, failure counting is
 * one atomic `INSERT ... ON CONFLICT (email) DO UPDATE` instead of read-then-write, so
 * parallel bad attempts can neither overshoot the window nor race the unique constraint
 * into a 500 (auth review 2026-11-11, L1).
 */
export interface RawSqlExecutor {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

export interface PasswordPolicyPluginOptions {
  /** Injected policy source (WMS: company settings loader). Omitted → defaults. */
  readonly loadPolicy?: PasswordPolicyLoader;
  /** Injected audit sink (WMS: `audit_log` writer). Failures here never block auth. */
  readonly onAuditEvent?: (event: PasswordPolicyAuditEvent) => void | Promise<void>;
  /** Raw SQL handle for the atomic lockout upsert (the factory passes the app's Drizzle db). */
  readonly rawDb?: RawSqlExecutor;
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

/**
 * A loaded policy over the defaults. One rule on top: a company that set its own character rules
 * (WMS company settings) keeps them for every length, unless it also names a passphrase length. So
 * the default passphrase rule never loosens a policy somebody chose on purpose.
 */
export function mergePasswordPolicy(partial: Partial<PasswordPolicy>): PasswordPolicy {
  const merged: PasswordPolicy = { ...DEFAULT_PASSWORD_POLICY, ...partial };
  const setOwnRules = partial.requireUpper !== undefined || partial.requireNumber !== undefined || partial.requireSymbol !== undefined;
  if (setOwnRules && partial.passphraseLength === undefined) {
    const { passphraseLength: _dropped, ...rest } = merged;
    return rest;
  }
  return merged;
}

async function resolvePolicy(loadPolicy: PasswordPolicyLoader | undefined): Promise<PasswordPolicy> {
  if (!loadPolicy) return DEFAULT_PASSWORD_POLICY;
  try {
    const partial = await loadPolicy();
    return mergePasswordPolicy(partial);
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
 * Counts a failed attempt. Semantics mirror WMS `registerFailure`: an attempt that lost
 * the race to a lockout does not touch the row (it must not clear `lockedUntil`);
 * reaching the threshold resets the counter and sets the deadline.
 *
 * With `rawDb` (the normal path — the factory passes the app's Drizzle handle) this is a
 * single atomic upsert: the count arithmetic and the lockout decision happen SQL-side
 * under the `email` unique constraint, so N parallel failures can neither skip counts
 * nor 500 on a duplicate insert (L1). Without it, the adapter read-then-write fallback
 * keeps the plugin usable standalone.
 */
async function registerFailure(
  adapter: PolicyAdapter,
  rawDb: RawSqlExecutor | undefined,
  email: string,
  policy: PasswordPolicy,
  now: Date,
): Promise<void> {
  if (rawDb) {
    const nowIso = now.toISOString();
    const lockIso = new Date(now.getTime() + policy.lockoutMinutes * 60_000).toISOString();
    const threshold = policy.lockoutThreshold;
    await rawDb.execute(sql`
      INSERT INTO core.password_policy_state (email, failed_login_count, locked_until)
      VALUES (
        ${email},
        CASE WHEN 1 >= ${threshold} THEN 0 ELSE 1 END,
        CASE WHEN 1 >= ${threshold} THEN CAST(${lockIso} AS timestamp) ELSE NULL END
      )
      ON CONFLICT (email) DO UPDATE SET
        failed_login_count = CASE
          WHEN password_policy_state.locked_until IS NOT NULL
            AND password_policy_state.locked_until > CAST(${nowIso} AS timestamp)
            THEN password_policy_state.failed_login_count
          WHEN password_policy_state.failed_login_count + 1 >= ${threshold} THEN 0
          ELSE password_policy_state.failed_login_count + 1
        END,
        locked_until = CASE
          WHEN password_policy_state.locked_until IS NOT NULL
            AND password_policy_state.locked_until > CAST(${nowIso} AS timestamp)
            THEN password_policy_state.locked_until
          WHEN password_policy_state.failed_login_count + 1 >= ${threshold}
            THEN CAST(${lockIso} AS timestamp)
          ELSE NULL
        END
    `);
    return;
  }
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

/**
 * Paths the lockout state machine covers (M3 residual): both verify a password for an
 * identified account, so both are credential oracles the per-email lockout must gate.
 */
const LOCKOUT_PATHS = new Set(['/sign-in/email', '/change-password']);

/** Better Auth's wrong-CURRENT-password code on `/change-password` (BASE_ERROR_CODES). */
const INVALID_CURRENT_PASSWORD_CODE = 'INVALID_PASSWORD';

type MiddlewareCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * The email the lockout state is keyed on. `/sign-in/email` identifies the account by
 * the request body; `/change-password` targets the SIGNED-IN user, so the email comes
 * from the session (M3 residual: a body-supplied email would let an attacker shard the
 * counter across keys and never trip the lock).
 */
async function lockoutEmail(ctx: MiddlewareCtx): Promise<string | null> {
  if (ctx.path === '/change-password') {
    const cached = ctx.context.session?.user as { email?: string } | undefined;
    if (cached?.email) return normalizeEmail(cached.email);
    try {
      const session = await getSessionFromCtx(ctx);
      return normalizeEmail(session?.user?.email);
    } catch {
      return null; // no/invalid session: the endpoint itself answers 401
    }
  }
  const body = (ctx.body ?? {}) as { email?: unknown };
  return normalizeEmail(body.email);
}

/** The password-bearing body field on a lockout-covered path (for the timing burn). */
function submittedPassword(ctx: MiddlewareCtx): unknown {
  const body = (ctx.body ?? {}) as { password?: unknown; currentPassword?: unknown };
  return ctx.path === '/change-password' ? body.currentPassword : body.password;
}

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

  /**
   * Attribution DATA for audit rows only (auth review 2026-11-11, L2 — accepted): the
   * first `x-forwarded-for` hop is attacker-chosen without a trusted proxy, so this
   * value must NEVER feed a trust decision (rate-limit keys, allow-lists). Spoof-aware
   * limiting uses the app's `clientIp`/`rateIp` (TRUST_PROXY-gated) instead.
   */
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
          // (WMS returned `locked` regardless of password correctness). Covers sign-in AND
          // change-password (M3 residual — both verify a password for the account).
          matcher: (ctx) => ctx.path !== undefined && LOCKOUT_PATHS.has(ctx.path),
          handler: createAuthMiddleware(async (ctx) => {
            const email = await lockoutEmail(ctx);
            if (!email) return;
            const adapter = ctx.context.adapter as unknown as PolicyAdapter;
            const state = await findState(adapter, email);
            const lockedTime = toTime(state?.lockedUntil);
            if (lockedTime !== null && lockedTime > now().getTime()) {
              await emitAudit({
                action: ctx.path === '/change-password' ? 'auth.password.rejected' : 'auth.login',
                outcome: 'failure',
                email,
                userId: null,
                reason: 'locked',
                ...requestMeta(ctx.headers),
              });
              // NEW-5: this gate rejects before any KDF runs, so a fast answer would be a
              // timing oracle distinguishing "locked" from "wrong password" (which costs a
              // full scrypt verify). Burn one dummy verification before throwing.
              await burnDummyPasswordVerify(submittedPassword(ctx));
              // M5: externally indistinguishable from a wrong password — the lock is
              // enforced silently and only the audit row above carries the reason.
              // On /change-password the "wrong password" answer is Better Auth's 400
              // INVALID_PASSWORD, so a locked account must answer the same way or the
              // status code becomes a lock oracle for session holders.
              const rejection =
                ctx.path === '/change-password'
                  ? new APIError('BAD_REQUEST', {
                      message: 'Invalid password',
                      code: 'INVALID_PASSWORD',
                    })
                  : new APIError('UNAUTHORIZED', {
                      message: INVALID_CREDENTIALS_MESSAGE,
                      code: INVALID_CREDENTIALS_CODE,
                    });
              Object.defineProperty(rejection, LOCKOUT_REJECTION, { value: true });
              throw rejection;
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
            if (ctx.path === '/change-password' && isUnchangedPassword(body.currentPassword, password)) {
              throw new APIError('BAD_REQUEST', {
                message: PASSWORD_UNCHANGED_MESSAGE,
                code: PASSWORD_UNCHANGED_CODE,
              });
            }
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
          // the counter and deadline. `/change-password` failures count too (M3): a wrong
          // CURRENT password there is the same credential guess as a wrong sign-in password.
          matcher: (ctx) => ctx.path !== undefined && LOCKOUT_PATHS.has(ctx.path),
          handler: createAuthMiddleware(async (ctx) => {
            const email = await lockoutEmail(ctx);
            if (!email) return;
            const adapter = ctx.context.adapter as unknown as PolicyAdapter;
            const meta = requestMeta(ctx.headers);
            const returned = ctx.context.returned;
            if (ctx.path === '/change-password') {
              if (!(returned instanceof Error)) {
                // The current password verified: the account owner is present.
                await clearFailures(adapter, email);
                return;
              }
              // A lockout rejection already audited as 'locked' and must not re-count.
              if (isLockoutRejection(returned)) return;
              // Only a wrong CURRENT password is a credential guess. Policy rejections of
              // the NEW password, missing-credential errors etc. never touch the counter.
              const code = (returned as { body?: { code?: string } }).body?.code;
              if (code !== INVALID_CURRENT_PASSWORD_CODE) return;
              const policy = await resolvePolicy(options.loadPolicy);
              await registerFailure(adapter, options.rawDb, email, policy, now());
              await emitAudit({
                action: 'auth.password.rejected',
                outcome: 'failure',
                email,
                userId: ctx.context.session?.user?.id ?? null,
                reason: 'invalid_current_password',
                ...meta,
              });
              return;
            }
            if (returned instanceof Error) {
              // A lockout rejection already audited as 'locked' and must not re-count.
              if (isLockoutRejection(returned)) return;
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
              await registerFailure(adapter, options.rawDb, email, policy, now());
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
