# Foundation F3 — Server platform (progress)

Plan: `docs/BUILD_PLAN.md` § F3 (lines 1373-1448). Status: **complete**.

- [x] `src/server/log.ts`: structured JSON logger (levels, redaction, `child()`, LOG_LEVEL)
- [x] `src/server/api/{errors,envelope,define-route,db}.ts`
- [x] `src/server/api-utils.ts`: legacy re-export shim. All pre-foundation routes keep working, and their auth is now DB-verified.
- [x] `src/server/auth/session.ts` + `session-store.ts`: JWT `sub/jti/sv`, `user_sessions` rows, revocation, `bumpSessionVersion`, sliding `lastSeenAt` (60 s resolution), 12 h absolute TTL
- [x] `src/server/auth/csrf.ts` + pure `csrf-shared.ts` (client contract below)
- [x] `src/server/auth/permission-catalog.ts` + `permission-catalog-data.ts`: 377 keys from 08 §Roles, plus the 4 default sets
- [x] `src/server/auth/permissions.ts`: `loadPermissions`, `can`/`canAny`/`requirePermission`, `requirePagePermission`, `redactFor`
- [x] `src/server/auth/scope.ts` (`getScope`, `narrowScope`, `scopedWhere`, `assertInScope`) and `context.ts` (`AuthContext`)
- [x] `src/server/auth/rate-limit.ts`: durable SQLite fixed window (one atomic UPSERT), `clientIp` honouring TRUST_PROXY
- [x] `src/server/auth/{password,password-policy,password-reset,login,audit}.ts`
- [x] `src/server/query/{grid-query,filters,sort,paginate,date-presets}.ts`
- [x] `src/proxy.ts` replaces the deprecated `src/middleware.ts` (deleted). It does the presence redirect, returns a 401 envelope for APIs, and issues `ks_csrf`.
- [x] Routes: `/api/health`, `/api/me` (GET/PATCH), `/api/auth/{login,logout,logout-all,csrf,forgot,reset,change-password,sessions}`
- [x] Tests in `tests/unit/foundation-f3/*`, 80 tests: grid-query, date presets, filters/sort/paginate on SQLite, permissions, CSRF, rate-limit, session revocation, scope, password/login/reset, errors/envelope/logger, and a defineRoute integration test
- [x] Verified:
  - `tsc` is clean and `npm test` passes 141/141.
  - eslint is clean on the F3 paths.
  - Login works in the browser and redirects to `?next=`.
  - `/dashboard`, `/orders`, `/inventory`, `/products`, `/jobs`, `/receiving`, `/clients`, `/locations`, `/reports`, `/settings` all return 200.
  - All legacy list APIs return 200.

## CSRF client contract (F4 `apiFetch`)
- Requests that are not GET, HEAD or OPTIONS send `x-csrf-token: <ks_csrf cookie>`. Read it with `readCsrfTokenFromCookie(document.cookie)` from `@/server/auth/csrf-shared`, which is pure and client-safe.
- If the cookie is missing, call `GET /api/auth/csrf`. It returns `{data:{token}}` and sets the cookie.
- On a 403 with envelope `code === "CSRF"`, refresh via `GET /api/auth/csrf` and retry once.
- Exempt from the token, but still origin-checked: login, logout, forgot, reset. Login also returns `data.csrfToken`.

## Envelope
- Success is `{ success:true, data, meta? }`.
- Failure is `{ success:false, error:"<message>", code, fieldErrors?, requestId? }`.
- Codes are the 0.2 set plus `UNAUTHENTICATED` (401), `CSRF` (403) and `INTERNAL` (500).

## Notes for later stages
- **defineRoute**
  - Mutations run in a SQLite transaction by default, so the handler must be **synchronous**. For async work, pass `transaction:false` and use `db.transaction` yourself.
  - Return plain data, `listResult(rows, meta)`, `created(x)`, `result(x,{status,headers})`, or a `Response` (needed to set cookies).
  - `ctx.grid()` parses the grid grammar. `ctx.actor` is `{userId, source: email}`, for F5 change_log and ledger calls.
- **F5** `DomainError` only needs `code` (a known ErrorCode) plus `message`. It maps by duck typing, or it can extend `AppError` from `@/server/api/errors`.
- **F2 seed**
  - Use `DEFAULT_ROLES` / `DEFAULT_ROLE_PERMISSIONS` from `permission-catalog.ts` for `roles` / `role_permissions`.
  - `hashPassword()` now defaults to 12 rounds. Lower-cost hashes still verify and are rehashed on login.
- **Permission fallbacks**
  - Legacy `users.role === "admin"` always receives every key (superuser).
  - A user with no `user_roles` gets `DEFAULT_ROLE_PERMISSIONS[users.role]`.
- **Scope fallback:** a non-admin with no `user_warehouses` rows sees all warehouses, for pre-seed compatibility. F2 should link users, and M14 should require at least one link.
- **Viewer default** is every `*.view` except Settings and Mobile, plus self-service profile/password. So a viewer gets 403 on `settings.users.view`, matching F8.
- **`requirePagePermission`** redirects to `/forbidden`. That page belongs to F4 (`src/app/(app)/forbidden/page.tsx`).
- **F4**
  - `useCan` / `<Can>` should read `permissions` from `GET /api/me`.
  - The same response has `contextOptions` for the header switcher.
  - `PATCH /api/me {context:{warehouseId,clientId}}` sets the `ks_ctx_wh` / `ks_ctx_client` cookies, which are scope-checked and only ever narrow.
- **F6:** `/api/health` reports the scheduler as `not_configured` until `@/server/scheduler` exports `getSchedulerHeartbeat()`.
- **Env:**
  - `TRUST_PROXY=1` lets rate limits use `x-forwarded-for`. Without it, every client shares one "direct" login bucket at 5/min.
  - `LOG_LEVEL` sets the minimum log level. Add both to `.env.example`, which F0 owns.
- **M14:** call `bumpSessionVersion(tx, userId)` on deactivation and on role changes.
- **Dev reset links** are written to the server log by the dev mail adapter. Use `setMailAdapter()` for production.
