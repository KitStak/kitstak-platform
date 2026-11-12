# Auth Security Review — phases 3+4 (2026-11-11)

All findings verified against the current tree (phases 3+4 are uncommitted on top of `95a7917`). Worst first.

---

## CRITICAL

### C1. Public self-registration grants WMS operational read access (viewer default + all-warehouse scope)
**Files:** `apps/wms/src/server/auth/session-store.ts:83-95`, `apps/wms/src/server/auth/permissions.ts:56-58`, `apps/wms/src/server/auth/scope.ts:46`, `packages/auth/src/options.ts:36-42`, `apps/wms/src/app/api/auth/[...all]/route.ts`

Better Auth is mounted with `emailAndPassword.enabled: true` and **no `disableSignUp`**, so `POST /api/auth/sign-up/email` is live on WMS (and CRM — the session table is shared). The old WMS had no self-registration at all. Chain:
1. Anyone signs up (`autoSignIn: true` → instant session; only check is the password-policy plugin validating password *strength*).
2. `resolveSession()` finds no `wms.user_profiles` row and defaults to `role: 'viewer'` ("minimum-privilege viewer defaults" comment, line 83).
3. `loadPermissions()` finds no `user_roles` rows → `DEFAULT_ROLE_PERMISSIONS['viewer']` = **every `*.view` permission outside Settings/Mobile** (`permission-catalog.ts:221-229`).
4. `scope.ts:46`: no `user_warehouses` rows → **falls back to ALL warehouses**.

**Exploit:** `curl -X POST https://wms.kitstak.io/api/auth/sign-up/email -d '{"email":"a@evil.com","password":"Str0ng!Passw0rd","name":"x"}'` → authenticated session → read every viewer-visible operational screen/API across all warehouses (client-scoped rows are hidden by empty `clientIds`, but warehouse-level and unscoped data are exposed).
**Fix:** set `emailAndPassword.disableSignUp: true` in WMS's `createAuth` call (CRM can keep sign-up if intended, but then profile-less users must resolve to **zero** permissions); change the no-profile fallback in `resolveSession`/`loadPermissions` to an explicit deny (`reason: 'no_profile'` already exists in the type — use it) instead of viewer defaults.

---

## HIGH

### H1. Lockout, inactive-user gate, and SSO password-block are WMS-instance-only — fully bypassable via the CRM origin
**Files:** `apps/crm/src/server/auth/auth.ts:50-61` (no `passwordCompat`, no `passwordPolicyPlugin`, no sign-in gate) vs `apps/wms/src/server/auth/auth.ts:104-164`

Both apps mount the *same* `core.user`/`core.account`/`core.session` tables, but the lockout plugin, `wmsSignInGate` (inactive-user refusal, `passwordLoginBlockedBySso` break-glass) exist only on the WMS instance. `POST crm.kitstak.io/api/auth/sign-in/email` verifies the same credential rows and issues a cookie valid on WMS (`Domain=.kitstak.io`).
**Exploit:** brute-force any scrypt-credential WMS account through the CRM endpoint — no account lockout ever increments (`password_policy_state` untouched), only Better Auth's in-memory 10/min/IP limit (per-process on Vercel, IP from spoofable headers). Likewise, when SSO enforce ships, password sign-in for non-admins is enforced only on WMS — CRM sign-in bypasses it wholesale. Inactive WMS users are blocked inside WMS by `resolveSession`, but their shared session still works on CRM.
**Fix:** move the lockout plugin (and later the SSO-enforce hook) into `createAuth` in `packages/auth` so every instance mounting the shared tables enforces it; the policy loader stays injected (CRM passes defaults). Lockout state is already in a shared `core.password_policy_state` table — only the enforcement is missing on CRM.

### H2. Forgot/reset rate limiting keyed on spoofable `auditIp` — unlimited reset-mail spam and token attempts
**Files:** `apps/wms/src/app/api/auth/forgot/route.ts:29`, `apps/wms/src/app/api/auth/reset/route.ts:28`, `apps/wms/src/server/api/define-route.ts:215-216 + 258`, `apps/wms/src/server/auth/rate-limit.ts:auditIp`

Both routes set `rateLimit: false` and hand-roll `hitRateLimit(db, RATE_LIMITS.passwordReset, ip)` using `ctx.ip` — which `defineRoute` populates from `auditIp(request)`, taking the **first `x-forwarded-for` hop unconditionally** (its own doc comment says "the rate-limit bucket keeps using `clientIp` (spoof-resistant)" — these routes don't).
**Exploit:** rotate `X-Forwarded-For: <random>` per request → every request lands in a fresh bucket → unbounded reset emails to any user (mail-bomb, SMTP reputation damage) and unbounded `POST /api/auth/reset` token guesses (token is 256-bit so guessing is infeasible, but the control is dead).
**Fix:** expose `rateIp` (i.e. `clientIp(request)`) on `RouteCtx` and key these two limiters on it; optionally add a per-email bucket for forgot.

### H3. Deactivation and privilege mapping don't bound the shared org: deactivated WMS users keep CRM access; WMS admins become Better Auth org-admins everywhere
**Files:** `packages/db/scripts/migrate-wms-identity.ts:49-53,109-117`, `packages/auth/src/access-control.ts:14-20`, `apps/wms/src/server/repositories/users.ts:581` (deactivate → `bumpSessionVersion` only)

- Deactivating a WMS user revokes sessions and `resolveSession` rejects them in WMS, but their `core.account` credential and `core.member` row survive — they simply sign in again at CRM (no `isActive` concept there) and retain platform-org access (combines with H1).
- Migration maps WMS `admin` → org `admin` (`adminAc` statements): every warehouse admin can now call `/api/auth/organization/*` on any app to **invite arbitrary emails into the platform org, update member roles up to admin, and remove members** — powers the WMS role never implied, and invited users become core users who (per C1) resolve to WMS viewers.
**Exploit:** a deactivated-for-cause WMS admin signs in at `crm.kitstak.io`, invites an outside email as org admin, and re-enters both apps through that identity.
**Fix:** on WMS deactivation also delete the credential `core.account` row (or set a shared `banned`/`is_active` flag Better Auth checks — e.g. a shared before-hook in `createAuth` consulting a core column); map WMS admin → org `member` (or a custom role without invitation/member-update statements) unless cross-app admin is genuinely intended.

---

## MEDIUM

### M1. bcrypt rehash-on-login never wired; CRM cannot verify migrated hashes at all
**Files:** `apps/wms/src/server/auth/auth.ts:135` (`passwordCompat: true` — no `onLegacyVerified`), `packages/auth/src/password-compat.ts:41-57`, `apps/crm/src/server/auth/auth.ts` (no `passwordCompat`)
Blueprint §1.1 requires "successful bcrypt login triggers rehash-to-default". Nothing passes `onLegacyVerified`, so migrated/seeded bcrypt hashes (seeds use **cost 10** with a comment claiming "upgraded on first login" — false) persist forever. And because CRM's instance lacks the compat verifier, a migrated WMS user signing in at CRM hits Better Auth's scrypt `verifyPassword` on a `$2b$...` string → malformed-hash error/500 — SSO contract broken and failures there bypass lockout accounting entirely (see H1).
**Fix:** enable `passwordCompat` inside the shared factory unconditionally, and wire `onLegacyVerified` to re-hash via `setCredentialPassword`-equivalent in the package.

### M2. Hardcoded dev-fallback `BETTER_AUTH_SECRET` enables cookie-cache forgery on any non-production deploy
**File:** `apps/wms/src/server/auth/auth.ts:66-79`
When `BETTER_AUTH_SECRET` is unset and `NODE_ENV !== 'production'` (previews, staging, `next dev` exposed on a LAN), the secret is `sha256('kitstak-dev-fallback-better-auth-secret')` — public in the repo and identical across installs. The secret signs the `kitstak.session_data` cookie-cache payload; `cookieCache.enabled: true` means a forged signed payload is accepted for up to 5 minutes anywhere that doesn't pass `disableCookieCache` (CRM's `getSession` does not — `apps/crm/src/server/auth/session.ts:45-50`).
**Fix:** derive the dev fallback from a per-install random (persisted temp file) or refuse to start when `TRUSTED_ORIGINS`/`AUTH_COOKIE_DOMAIN` indicate a shared deployment; never a repo-constant digest.

### M3. Better Auth's own `/api/auth/change-password` bypasses WMS's change-password controls
**Files:** `apps/wms/src/app/api/auth/[...all]/route.ts` vs `apps/wms/src/app/api/account/password/route.ts`
WMS built a guarded route (Postgres 5/15min per-user limit, audit rows, wms mirror columns, lockout clear, keep-current-session rotation), but the catch-all still serves Better Auth's `/change-password`: current-password verification with only the in-memory 5/60s per-IP rule (per-process, spoofable IP) and **no lockout coverage** — a session-hijacker can brute-force the current password as an oracle; successful changes skip `wms.users` mirrors, `password_changed_at`, lockout clearing, and audit.
**Fix:** add a before-hook (in `wmsSignInGate` or the plugin) rejecting `/change-password` (and `/update-user` email-adjacent paths you don't use) on the WMS instance, pointing clients at `/api/account/password`; or extend lockout to count `/change-password` failures.

### M4. Auth-path rate limiting regressed to per-process memory with header-derived IPs
**File:** `packages/auth/src/create-auth.ts:58-71`
`rateLimit.storage: 'memory'` on serverless (three Vercel projects planned) means each lambda instance keeps its own counters, and Better Auth keys by `x-forwarded-for`-derived IP. WMS previously had Postgres-backed `login-ip`/`login-account` buckets that survived cold starts. The lockout plugin compensates per-account on WMS only (H1).
**Fix:** implement Better Auth's secondary-storage/database rate-limit storage (it supports `storage: 'database'` with a `rateLimit` model via the adapter) or reuse the existing Postgres `rate_limits` table through a custom storage.

### M5. New error contract enables account enumeration
**Files:** `packages/auth/src/password-policy-plugin.ts:267` (`ACCOUNT_LOCKED`), `apps/wms/src/server/auth/auth.ts:121` (`SSO_REQUIRED`), sign-up "user already exists" (Better Auth default)
`ACCOUNT_LOCKED` and `SSO_REQUIRED` are only ever returned for existing accounts (lockout rows are created only for known users — plugin after-hook line 320-334), and open sign-up returns a distinct exists-error; all distinguishable from `INVALID_CREDENTIALS`. The retired soft-failure contract returned a uniform 200 `{success:false}`.
**Fix:** return the generic invalid-credentials message for locked accounts (keep the lock enforced silently, audit internally); closing sign-up (C1) removes the second oracle.

### M6. Shared `BETTER_AUTH_SECRET` is also the CRM webhook-secret KDF input — blast radius now ×3
**Files:** `apps/crm/src/server/services/automations-webhooks.ts:55`, blueprint risk register (1)
`sha256('kitstak:webhook-secret:v1:' + BETTER_AUTH_SECRET)` encrypts `webhooks.secret_ciphertext`. The same string now lives in WMS and (later) portal envs, so compromise of any app's env discloses CRM webhook secrets, and rotation (e.g. after a WMS incident) silently bricks CRM webhook decryption. `INTEGRATION_KEY` fallback to `SESSION_SECRET` (`apps/wms/src/server/integrations/crypto.ts:18-22`) is fail-safe in prod but `SESSION_SECRET` retirement must be sequenced after `INTEGRATION_KEY` is set, per blueprint.
**Fix:** give CRM webhooks their own `WEBHOOK_KDF_SECRET` (one-time re-encrypt) before the shared secret ships to three deployments; set `INTEGRATION_KEY` explicitly now.

---

## LOW

### L1. Lockout state machine race windows
**File:** `packages/auth/src/password-policy-plugin.ts:174-194`
`registerFailure` is read-then-write with no uniqueness guard on concurrent first failures: parallel bad attempts can (a) overshoot the threshold window (TOCTOU between before-gate and after-hook is acknowledged, but N parallel requests all pass the gate), and (b) two concurrent `create()` calls on a new email race the `email` unique constraint — the loser throws inside the after-hook, surfacing a 500 on a failed login.
**Fix:** upsert (`ON CONFLICT (email) DO UPDATE SET failed_login_count = ...`) via raw SQL or catch-and-retry in `registerFailure`.

### L2. Origin check passes Origin-less non-browser requests; audit/lockout IPs spoofable
**Files:** `apps/wms/src/server/auth/origin.ts:41-48`, `packages/auth/src/password-policy-plugin.ts:225-228`
Documented and acceptable for CSRF (no cookies ride along), but `requestMeta`/`auditIp` take raw first-hop `x-forwarded-for` regardless of `TRUST_PROXY`, so audit rows and lockout audit attribution are attacker-chosen strings. Keep as data, never as a trust input (H2 is where it became one).

### L3. bcrypt 72-byte truncation on the compat verify path
**File:** `packages/auth/src/password-compat.ts:44-54`
`bcrypt.compare` silently truncates at 72 bytes: a migrated user whose legacy password exceeded 72 bytes authenticates with any suffix. The 72-byte policy cap (`password-policy-plugin.ts:58-59`) applies to *new* passwords and only on the WMS instance (CRM accepts up to 128 chars — fine for scrypt, but the asymmetry means a WMS user can set a >72-byte password via CRM's `/change-password`). Acceptable residual risk; converges to zero once M1 (rehash) lands.

---

## Accepted risks

Residuals reviewed in round 2 (2026-11-12) and accepted deliberately — do not re-report without new facts.

### A1. CRM public sign-up reveals account existence (M5 residual)
`POST crm.kitstak.io/api/auth/sign-up/email` answers Better Auth's distinct "User already exists" error for a taken email, so public sign-up remains an account-enumeration oracle.
**Rationale:** public self-service sign-up inherently reveals existence — any flow that refuses a duplicate email (or sends a "you already have an account" mail) discloses the same bit, and a uniform answer would break legitimate onboarding UX. The locked-account and SSO oracles (the exploitable halves of M5) are closed: those paths answer the generic invalid-credentials contract. Mitigated by the durable rate limits on `/sign-up/email` (DB-backed `core.rate_limit`, 5 per 10 min) and sign-up being closed on WMS entirely (C1).

### A2. Spoofable first-hop `x-forwarded-for` on audit rows (L2)
Audit/forensic IP attribution (`auditIp`, plugin `requestMeta`) takes the first `x-forwarded-for` hop unconditionally, so without a trusted proxy it is an attacker-chosen string.
**Rationale:** accepted as documented — the value is display/forensics DATA only. Every trust decision (rate-limit keys, lockout gates) keys on `clientIp`/`rateIp` (TRUST_PROXY-gated) or on the per-account lockout state, and Better Auth's own limiter now takes an explicit `advanced.ipAddress` trust config (round-2 NEW-3).

### A3. Legacy webhook-secret KDF path remains until re-encryption (M6 residual)
`WEBHOOK_KDF_SECRET` decouples CRM webhook-secret encryption from the shared `BETTER_AUTH_SECRET`, but when it is unset the legacy derivation (`sha256('kitstak:webhook-secret:v1:' + BETTER_AUTH_SECRET)`) still decrypts existing ciphertexts, with a server-side deprecation warning.
**Rationale:** a hard cut would brick every stored webhook secret that predates the new env var. The migration path (set `WEBHOOK_KDF_SECRET`, re-encrypt, then rotate the shared secret) is sequenced in the blueprint risk register; until it completes, compromise of any app's `BETTER_AUTH_SECRET` still discloses CRM webhook secrets created before the cutover.

---

**Summary:** 1 CRITICAL, 3 HIGH, 6 MEDIUM, 3 LOW. The structural theme behind C1/H1/H3/M1/M3: security policy that must hold for the *shared* `core` tables (sign-up posture, lockout, active-flag, hash compat, change-password controls) was implemented on the WMS instance only, while every instance mounting those tables is an equally valid door. Fix direction: push those invariants into `packages/auth`'s `createAuth` so they are instance-independent, and make the WMS no-profile fallback deny instead of defaulting to viewer.
