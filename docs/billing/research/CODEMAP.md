# Signup and billing: codebase map

Read only survey of everything the signup and billing work touches, taken on 2026-11-23 at commit `31058fe`
(clean tree). Paths are from the repo root. Each section ends with the gaps and bugs found there. Section 14
ranks them.

State of the checkout when this was written: `node_modules` is not installed (no `node_modules/.bin`, so
`node_modules/next/dist/docs` is missing until `pnpm install` runs), there is no `.env.local` in any app, there
is no `.github/` folder (no CI), `stripe` does not appear in `pnpm-lock.yaml`, and `docs/billing/` did not exist.
No test or build was run for this map.

## 1. Topology

| App | Package name | Dev port | Prod origin | Signup | Notes |
|---|---|---|---|---|---|
| `apps/portal` | `kitstak-portal` | 3300 | `https://kitstak.app` | open (front door) | launcher, billing, org settings |
| `apps/crm` | `kitstak-crm` | 3100 | `https://crm.kitstak.app` | open (second door) | has `/signup`, `/forgot-password`, `/reset-password`, `/welcome/invite/[invitationId]` |
| `apps/wms` | `kitstak-wms` | 3000 | `https://wms.kitstak.app` | `disableSignUp: true` | one Postgres schema per org (`core.wms_tenants`) |
| `apps/projects` | `kitstak-projects` | 3400 | `https://projects.kitstak.app` | `disableSignUp: true` | `pm` schema |
| `apps/pulse` | `kitstak-pulse` | 3500 | `https://pulse.kitstak.app` | `disableSignUp: true` | `pulse` schema, CSP nonce, db guard |
| `apps/web` | `kitstak-web` | 3400 | `https://kitstak.com` | none | static marketing site, only depends on `@kitstak/ui` |

- BLUEPRINT.md still says `*.kitstak.io` and three apps. The live truth is `*.kitstak.app` and five product apps
  (`docs/DEPLOYMENT.md`, `apps/web/src/components/site-links.ts` `LINKS`).
- Packages ship TypeScript source, no build step. Every consumer lists them in `transpilePackages` in its
  `next.config.ts`. Direction: `config <- ui, db <- auth <- entitlements <- apps`. No package imports an app, and
  no app imports another app.
- **Bug:** `apps/web` and `apps/projects` both run `next dev -p 3400`. `pnpm dev` (turbo, all apps) cannot start
  both. Any local end to end run of marketing site to portal needs the web app on another port.

## 2. `packages/auth` (`@kitstak/auth`)

| File | What is in it |
|---|---|
| `src/options.ts` | `sharedAuthOptions`, `organizationPlugin()`, `SESSION_COOKIE_PREFIX = 'kitstak'`, `SESSION_COOKIE_NAMES`, `PASSWORD_MIN_LENGTH = 10`, `PASSWORD_MAX_LENGTH = 72`. Session 14 days, cookie cache 5 minutes. `emailAndPassword.autoSignIn: true`. User extra fields `title`, `timezone`. |
| `src/create-auth.ts` | `createAuth(options: CreateAuthOptions)`, `ipAddressFromTrustProxy()`, type `KitstakAuth`. Always mounts `passwordPolicyPlugin`, `legacyRehashPlugin`, `signOutCookieSweepPlugin`; `nextCookies()` must stay last. Rate limits live in `core.rate_limit`: `/sign-up/email` 5 per 10 minutes, `/sign-in/email` 10 per minute, `/request-password-reset` 5 per 10 minutes. Accepts `extraPlugins`, `hooks`, `disableSignUp`, `cookieDomain`. |
| `src/access-control.ts` | `orgAccessControl`, `orgRoles`: `owner`, `admin`, `member`, `viewer`, `guest`. |
| `src/create-auth-client.ts` | `createKitstakAuthClient({ baseURL? })` with `organizationClient` and `inferAdditionalFields`. Import from `@kitstak/auth/client`. |
| `src/session-cookie.ts` | `getKitstakSessionCookie(request)`, `hasKitstakSessionCookie(request)` for edge proxies. |
| `src/password-policy-plugin.ts` (539 lines) | Lockout and policy, `validatePassword`, `DEFAULT_PASSWORD_POLICY`, `isUnchangedPassword`. |
| `src/password-compat.ts`, `src/sign-out-cookie-sweep.ts`, `src/timing.ts` | bcrypt compat verify, cross domain cookie clearing on sign out, timing helpers. |

Org model (Better Auth organization plugin): `creatorRole: 'owner'`, `allowUserToCreateOrganization: true`,
`membershipLimit: 1000`, invitations expire in 7 days, `cancelPendingInvitationsOnReInvite: true`, teams on.
Member roles are stored as comma lists; CRM marks a removed member with the prefix `deactivated:`.

Gaps:
- **No email anywhere.** There is no `sendResetPassword`, `sendVerificationEmail`, `emailVerification` or
  `sendInvitationEmail` in `sharedAuthOptions`, and no mail library in any `package.json`. So: no email
  verification at signup, no working "forgot password" mail, invitations create a row and send nothing, and there
  is no channel for receipts, trial ending or failed payment notices. Stripe can send its own receipts and
  invoice mails; everything else needs a mailer or an honest in app notice.
- No organization hooks (`organizationHooks`, `databaseHooks`) are used anywhere. Nothing runs on the server when
  an org is created, so there is no server side place that starts a trial today.
- A user may create any number of orgs. If each new org gets a 14 day trial, trials can be farmed. Needs a rule
  (for example one trial per user or per email domain) in the trial writer.
- Auth review `docs/security/auth-review-2026-11-11.md` theme (C1, H1, H3, M1): any rule that must hold for the
  shared `core` tables belongs in a package, because every app that mounts the tables is a door. Billing rules
  follow the same logic: the CRM also hosts `/api/auth/organization/*` and its own `/signup`. Accepted risk A1:
  public signup reveals that an email exists.

## 3. `packages/db` (`@kitstak/db`) and migrations

Schema barrel `src/schema/index.ts`. Billing tables in `src/schema/core/billing.ts`:

- `stripeCustomers` (`core.stripe_customers`): `org_id` uuid PK, `stripe_customer_id` text unique, `created_at`.
- `entitlements` (`core.entitlements`): `id`, `org_id`, `module` (`crm|wms|projects|pulse`), `status`
  (`active|trialing|past_due|canceled`), `source` (`stripe|manual|trial`, default `stripe`),
  `stripe_subscription_id`, `stripe_price_id`, `seats`, `current_period_end`, timestamps. Unique
  `(org_id, module)`.
- `billingEvents` (`core.billing_events`): `id` text PK (the Stripe event id), `type`, `payload` jsonb,
  `processed_at` default now.
- Exports `ENTITLEMENT_MODULES`, `ENTITLEMENT_STATUSES`, `ENTITLEMENT_SOURCES` and the row types.

Other core tables that matter: `src/schema/core/onboarding.ts` (`onboardingProgress`, scopes
`portal|crm|wms`, statuses `completed|skipped|dismissed`), `src/schema/core/auth.ts` (Better Auth tables,
generated), `src/schema/core/wms-tenants.ts`, `src/schema/core/rate-limit.ts`.
Column helpers in `src/schema/_shared.ts`: `coreSchema`, `id()`, `orgId()`, `createdAt()`, `updatedAt()`,
`auditStamps()`. Driver factories: `src/client-pg.ts` (`createPgPool`, `createPgDb`, `createPgClient`, used by
portal and CRM) and `src/client-postgres-js.ts` (WMS).

Migration process (`packages/db/drizzle/README.md`, binding):
- Hand written SQL in `packages/db/drizzle/000N_*.sql`, statements split by `--> statement-breakpoint` lines.
- Only files listed in `drizzle/meta/_journal.json` run. Latest is `0006_core_pulse_module` (idx 6). The next
  file is `0007_*`.
- Runner `scripts/db-migrate.ts` (`pnpm --filter @kitstak/db db:migrate [url]`): journal order, one transaction
  per file, advisory lock `7_202_611_503`, applied tags and a content hash in `drizzle.__kitstak_db_migrations`.
  **Editing an applied file aborts the run.** Never run `drizzle-kit push` anywhere.
- Mirror every SQL change in `src/schema/core/*.ts`. RLS is enabled with no policies on every core table (apps
  connect as the owner role), so a new table needs `ENABLE ROW LEVEL SECURITY` too.
- Order on a real database (`docs/DEPLOYMENT.md`): CRM, then WMS, then `@kitstak/db`, then Projects, then Pulse.
  The CRM migrations create the Better Auth tables in `core`; `0001_core_fks.sql` adds FKs only if they exist.
- Trap: `apps/projects/drizzle/0000_pm_init.sql` narrows `entitlements_module_check` to three modules on a fresh
  database, and `apps/pulse/drizzle/0000_pulse_init.sql` widens it again. Any new CHECK on `core.entitlements`
  must survive that order.
- Production helper: `node deploy/with-prod-db.mjs <command>` injects the database address from
  `deploy/secrets.env`.

Gaps:
- Drift: the Drizzle `check('entitlements_module_check', ...)` literal in `billing.ts` still lists three modules
  (`crm, wms, projects`); the SQL and the TS enum have four. Harmless at runtime (SQL is hand written) but wrong.
- The tables cannot hold what a real billing page shows: no billing interval, no cancel at period end, no trial
  start or end distinct from the period end, no quantity per line beyond `seats` (WMS is priced per warehouse),
  no payment method summary, no invoices, no plan snapshot, and `billing_events` has no `org_id`, no status and
  no error column. Expect a `0007` migration and probably a subscription table per org.
- `stripe_customers.org_id` and `entitlements.org_id` have SQL FKs with `ON DELETE CASCADE` to
  `core.organization`. Deleting an org drops its billing rows while a Stripe subscription may still be live.

## 4. `packages/entitlements` (`@kitstak/entitlements`)

| File | Exports |
|---|---|
| `src/modules.ts` | `type Module`, `MODULES`, `isModule()`. Compile time lock against the schema enum. |
| `src/read.ts` | `getEntitlements(db, orgId)` (60 second per process cache), `isEntitled(entitlement, now)`, `hasModule(db, orgId, module)`, `clearEntitlementsCache(orgId?)`, `GRACE_DAYS = 7`, types `ModuleEntitlement { status, source, periodEnd }`, `EntitlementSnapshot`. |
| `src/grant.ts` | `grantModule(db, orgId, module, source = 'manual')` (upsert to `active`), `revokeModule(...)` (upsert to `canceled`). |
| `src/dev.ts` | `isDevAllowAll(env)`: true only for `ENTITLEMENTS_DEV_ALLOW_ALL` of `1` or `true`. |
| `src/db.ts` | `EntitlementsDb = Pick<PgDatabase, 'select' | 'insert'>`. |
| `scripts/grant.ts` | CLI: `pnpm --filter @kitstak/entitlements grant grant|revoke|list <org-slug> [module]`. |
| `src/read.test.ts`, `src/grant.test.ts` | vitest with a plain object db mock. |

The blueprint's `src/sync.ts` and `src/stripe.ts` do not exist. The package description says "no Stripe code
lives here".

Gaps and bugs:
- **Trials never end.** `isEntitled` returns true for `trialing` without looking at `periodEnd`. A no card trial
  has no Stripe subscription to flip the status, so either `isEntitled` must treat `trialing` past its period end
  as blocked, or a scheduled job must expire rows. A read time check is safer because there is no cron in the
  portal.
- `upsertEntitlement` writes only `status` and `source`. It cannot set `current_period_end`, `seats`,
  `stripe_subscription_id` or `stripe_price_id`, and on conflict it overwrites `source`. A new writer is needed
  for trial and Stripe state, and it must not let a trial or a webhook stomp a `manual` grant (decision: manual
  grants keep working).
- `EntitlementsDb` has no `update`, `delete` or `transaction`. A sync that writes the ledger and the entitlements
  atomically needs a wider seam.
- The cache is per process and 60 seconds. After checkout the portal process sees the change at once
  (`clearEntitlementsCache`), but CRM, WMS, Projects and Pulse can stay locked for up to 60 seconds. The post
  checkout screen has to say so or the apps need a shorter TTL or a version check.
- `ModuleEntitlement` does not carry `seats`. Nothing enforces seat counts today (Pulse covers up to 5 seats).
- The `grant` CLI usage text lists three modules in its header comment; the code accepts four.

## 5. The dev switch is read two different ways

- Portal (`apps/portal/src/server/entitlements.ts` `getOrgModuleStates`) and the package use the strict
  `isDevAllowAll()`: allow all only when the variable is `1` or `true`.
- CRM, WMS, Projects and Pulse each define `entitlementsAllowAll(env)`: an explicit value wins, and **unset means
  allow all whenever `NODE_ENV` is not `production`**.
- `apps/portal/.env.example` sets `ENTITLEMENTS_DEV_ALLOW_ALL=1`; the CRM and WMS examples leave it empty.
- **Production today runs with `ENTITLEMENTS_DEV_ALLOW_ALL=1`** on every project (`deploy/push-env.mjs` lines 131
  and 157, `docs/DEPLOYMENT.md` "1 until Stripe lands"). Turning billing on means removing that value, which
  locks every existing org at once unless each one first gets a manual grant or a trial row. This needs a
  written rollout step and a backfill.
- To see a real lock or a real trial locally, set `ENTITLEMENTS_DEV_ALLOW_ALL=0` in the portal **and** in every
  product app. Unset is not enough in the product apps.

## 6. Gating choke points in the product apps

| App | Gate helper | Pages | API and actions | Locked screen |
|---|---|---|---|---|
| CRM | `apps/crm/src/server/entitlements.ts`: `orgHasCrmModule(orgId)`, `orgModuleFlags(orgId)`, `entitlementsAllowAll()` | `getPageOrgMembership()` in `apps/crm/src/server/auth/session.ts` line 128 redirects to `/${slug}/locked` | `withApi()` in `apps/crm/src/server/api.ts` line 223 returns 402 `{ ok:false, error:{ code:'entitlement.missing', module:'crm' } }` | `apps/crm/src/app/(locked)/[orgSlug]/locked/page.tsx`, links to `${NEXT_PUBLIC_PORTAL_URL}/billing` |
| WMS | `apps/wms/src/server/auth/entitlements.ts`: `wmsModuleEntitledForOrg(db, orgId)`, `requireWmsEntitlement(db, orgId, pathname)`, `entitlementMissingError()` | `loadShellProps()` in `apps/wms/src/server/shell/shell-props.ts` line 102 redirects to `/locked` | `defineRoute()` in `apps/wms/src/server/api/define-route.ts` line 182, 402 `ENTITLEMENT_MISSING`; exempt `/api/health`, `/api/cron/tick`, `/api/admin/bootstrap` | `apps/wms/src/app/locked/page.tsx`, links to `${portal}/billing` |
| Projects | `apps/projects/src/server/entitlements.ts`: `orgHasProjectsModule`, `orgModuleFlags` | `apps/projects/src/features/shell/shell-frame.tsx` line 15, rendered by `apps/projects/src/app/(app)/layout.tsx` line 27 | `apps/projects/src/server/http/api.ts` line 98, `apps/projects/src/server/actions/_action.ts` line 63 | `apps/projects/src/features/shell/locked-screen.tsx` `LockedScreen({ orgName, portalUrl, canManage })`, links to `${portal}/billing?module=projects` |
| Pulse | `apps/pulse/src/server/entitlements.ts`: `orgHasPulseModule`, `orgModuleFlags` (inside `asSystem`) | `apps/pulse/src/features/shell/shell-frame.tsx` line 18, `apps/pulse/src/app/(app)/layout.tsx` line 35 | `apps/pulse/src/server/http/api.ts` line 119, `apps/pulse/src/server/actions/_action.ts` line 64, plus `api/v1/log/rows`, `api/v1/cron/reports`, `features/reports/server/file-route.ts` | `apps/pulse/src/features/shell/locked-screen.tsx` `LockedScreen`, links to `${portal}/billing?module=pulse`; `NoAccessScreen` is a different state |

Cross app reads of other modules' flags: CRM layout `apps/crm/src/app/(app)/[orgSlug]/layout.tsx` line 38, CRM
bridges `server/services/projects-bridge.ts` and `pulse-bridge.ts`, WMS `server/shell/shell-props.ts` line 52 and
`server/projects/bridge.ts`, `server/pulse/bridge.ts`, WMS tenancy `server/tenancy/provision.ts` line 103
(`provisionWarehouse` refuses without the WMS module) and `registry.ts`, Projects and Pulse
`server/integrations/detect.ts` and `api/v1/me/route.ts`, Pulse `features/integrations/connected-apps.tsx`
(links to `${portal}/billing/upgrade?module=<app>`).

Gaps:
- The four lock screens differ. CRM and WMS say "contact your administrator" and link to plain `/billing` with
  no `module`, and only when `NEXT_PUBLIC_PORTAL_URL` is set. Projects and Pulse are friendlier and pass
  `?module=`. None knows about trial ended, past due, or canceled, and none shows a price or a "start free
  trial" action. WMS uses different class names (`bg-muted/30`, `text-muted-foreground`) from the token names
  the other apps use.
- No app shows a trial countdown, a grace banner, or a "payment failed" banner. `past_due` inside grace is
  silently entitled.
- Naming hazard: WMS has its own `/billing` route, API and permission (`settings.billing.view`) for **3PL client
  billing**. Pulse also has `WMS_VAS_PATH = '/billing/vas'`. Never call the subscription area just "Billing"
  inside WMS, and never add a WMS route named `/billing`.
- WMS is the only module with a provisioning step after it is licensed (a schema per org). A trial that includes
  WMS only becomes usable after `provisionWarehouse` runs; check that the WMS first run handles a brand new trial
  org.

## 7. Portal (`apps/portal`)

Stack: Next 16.4.5, React 19.3, Tailwind 4 through `@tailwindcss/turbopack`, zod 4, `cmdk`, `lucide-react`,
`class-variance-authority`, `@radix-ui/react-dropdown-menu`. No `stripe` dependency.

### Request edge and env
- `src/proxy.ts`: `proxy(request)` only consumes the theme handoff (`ks-theme` param). **There is no public path
  list and no auth gate in the proxy.** Auth is enforced in `src/app/(app)/layout.tsx` through
  `requirePageSession()`. A webhook route under `src/app/api/` is therefore reachable without a session, and it
  must do its own signature check. The proxy matcher skips paths with a dot and `_next/`.
- There is no CSRF or origin check in the portal proxy (the CRM proxy has one). Server actions get Next's own
  origin check; any new POST route handler must check the session and the origin itself.
- `next.config.ts`: static security headers, no CSP. `Permissions-Policy` includes `payment=()`, which turns off
  the Payment Request API (Apple Pay and Google Pay buttons) for the page and any frame. Fine for hosted
  Checkout by redirect. Embedded Checkout or the Payment Element would need `payment=(self "https://js.stripe.com")`
  or similar. `X-Frame-Options: DENY` and `Cross-Origin-Opener-Policy: same-origin` are fine for redirects.
  `serverExternalPackages: ['pg']` (add `stripe` there if it is used). `/api/*` is `no-store`.
- `src/server/env.ts`: zod `envSchema`, lazy `env` proxy, `loadEnv()`, `isProduction()`, `trustedOrigins()`.
  Variables: `NODE_ENV`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`,
  `TRUSTED_ORIGINS`, `NEXT_PUBLIC_{CRM,WMS,PROJECTS,PULSE}_URL`, `AUTH_COOKIE_DOMAIN`, `TRUST_PROXY`,
  `WMS_PLATFORM_ORG_SLUG`, `DB_POOL_MAX`. **No Stripe variables.** `.env.example` says "Stripe is DEFERRED".
  `ENTITLEMENTS_DEV_ALLOW_ALL` is read from `process.env` by the package, not through this schema.
- `src/server/auth.ts`: `auth` (lazy proxy over `createAuth`), `kitstakOrgMetadataHooks` (blocks writes to org
  `metadata`, redacts it from responses). So org metadata is **not** a place to keep plan data.
- `src/server/db.ts`: `db`, `getDb()`, `getPool()` (node-postgres, pool of 5).
- `src/server/session.ts`: `getSession()` (React `cache`), `getSessionFromHeaders(headers)`,
  `requirePageSession(returnTo?)`.
- `src/server/orgs.ts`: `listUserOrgs(userId)`, `resolveActiveOrg(session, orgs?)`, `getOrgOwner(orgId)`,
  `getOrgGlance(orgId)`. `OrgSummary.role` is the first role in the comma list.
- `src/lib/routes.ts`: `safeNextPath(next, fallback)`, `safeReturnUrl(next, allowedOrigins, fallback)`.
  Stripe success and cancel URLs should be built on the server from `env`, never from a query value.

### Signup and login
- `src/app/(auth)/layout.tsx`: split layout, form left, `.auth-hero` panel right (`LauncherPreview`). The preview
  shows only CRM and WMS tiles; Projects and Pulse are missing.
- `src/app/(auth)/signup/page.tsx` reads only `?next=`. `signup-form.tsx` `SignupForm({ next })`: fields name,
  email, password (with `StrengthMeter`), company. Client flow: `signUp.email()` then `createOrganization(name)`
  (`organization.create` with `slugify`, one retry with `slugWithSuffix`, then `organization.setActive`), then
  `router.replace(safeNextPath(next, '/welcome'))`.
- `src/app/(auth)/_components/form-parts.tsx`: `AuthHeading`, `FormAlert`, `PasswordInput`, `StrengthMeter`,
  `passwordStrength()`, `authErrorMessage()`, local `PASSWORD_MIN_LENGTH`, `PASSWORD_MAX_LENGTH`.
- `src/app/(auth)/login/`: `LoginForm({ next, notice })`, "Keep me signed in", `HandoffScreen` while pending.
- `src/app/(auth)/change-password/`: forced change after an administrator set password.
- `src/app/api/auth/[...all]/route.ts`: Better Auth handler. This is the only API route in the portal.

Gaps and bugs:
- **The marketing hand off is dropped.** `apps/web` sends `focus`, `products`, `businessType`, `teamSize`,
  `startMode` to `/signup`; the page ignores them all. The chosen products never become entitlements, the plan
  the visitor priced is lost, and the welcome wizard asks the same questions again.
- Seats, warehouses, billing interval and the guided setup flag are not in the hand off URL at all.
- Name, email and company typed on the marketing site are retyped on the portal (they are kept out of the URL on
  purpose).
- The org is created from the browser after the account. If the second call fails the user lands on `/welcome`
  with an account and no org (`WelcomePage` then shows `CreateOrgForm`). The error is swallowed. A trial grant
  tied to org creation has to cover both this path and `CreateOrgForm`
  (`src/features/launcher/create-org-form.tsx`) and the CRM's own org creation.
- No forgot password link or page in the portal (the CRM has pages, but no mail is sent anywhere).
- No email verification, no terms or privacy acceptance, no legal links (CRM has `(legal)/privacy` and `terms`).
- No social or SSO sign in. No invitation accept route in the portal; the only one is the CRM's
  `/welcome/invite/[invitationId]`. `InviteMemberForm` shows "Invitation created." and nothing is sent.
- A signed in user who opens `/signup?...` is redirected to `/`, losing the hand off.
- `authErrorMessage` falls back to the raw Better Auth message.
- Autofill is mostly right (`name`, `email`, `new-password`, `organization`, `current-password`). No `inputMode`
  or `enterKeyHint`, and `autoFocus` on the first field opens the keyboard on phones.

### Welcome wizard and setup guide
- `src/app/(app)/welcome/page.tsx` `WelcomePage`: owner or admin only, skips when a profile exists.
- `src/features/welcome/welcome-wizard.tsx` `WelcomeWizard({ firstName, orgName, crmEntitled, wmsEntitled })`:
  steps `focus`, `about`, `start`, `plan`; saves through `saveSetupProfile`. Tiles in `option-tile.tsx`
  (`TileGroup`, `PillGroup`).
- `src/lib/setup-model.ts`: `SetupProfile { focus, businessType, teamSize, startMode }`, `SetupFocus =
  'wms' | 'crm' | 'both'`, `parseSetupProfile`, `SETUP_STEP_KEYS`, `buildSetupSteps`, `summarizeSetup`,
  `readProgressRows`, `GUIDE_STEP_KEY`. Tests in `setup-model.test.ts`.
- `src/server/onboarding.ts`: `getSetupState(org)`, `markGuideSeen(orgId)`, `guideEntitlements { crm, wms }`.
- `src/server/onboarding-actions.ts` (`'use server'`): `saveSetupProfile`, `skipSetupStep`, `unskipSetupStep`,
  `dismissSetupGuide`, `restoreSetupGuide`; private `requireManager()` and `upsertOrgStep()`. This is the
  pattern to copy for billing server actions: act on the session's active org, never on an org id from the
  client, require owner or admin, return `ActionResult { ok, error? }`, call `revalidatePath`.
- `src/features/setup/setup-guide.tsx` `SetupGuide`, `progress-ring.tsx`, `confetti.tsx`.
- Contract: `docs/integration/ONBOARDING.md` (step names, done over skipped over locked over ready, celebration
  only when everything is truly done, no raw emoji in headings).

Gaps:
- `focus` only knows CRM and WMS. A Projects only or Pulse only signup has no focus (`portalFocus` returns null
  on the web side) and the wizard defaults to `both`.
- The guide has no billing step ("Pick your plan", "Add a card before your trial ends").
- The `onboarding_progress.scope` CHECK is still `portal | crm | wms`; a billing step must be stored under
  `portal`.

### Billing pages (all honest stubs today)
- `src/app/(app)/billing/page.tsx` `BillingPage`: a four row table (module, status badge, source, period end)
  from `getOrgModuleStates`, a banner when `?module=` is present, and a card titled "Online billing coming
  soon". No prices, no actions.
- `src/app/(app)/billing/upgrade/page.tsx` `UpgradePage`: feature list from `UPGRADE_COPY`, the line "Pricing is
  confirmed at checkout. No charge happens on this page.", then `CheckoutGate`.
- `src/features/billing/checkout-gate.tsx` `CheckoutGate({ moduleName, orgName, isOwner, owner })`: "Proceed to
  checkout" reveals either "Ask your organization owner" with a `mailto:` link, or "Online checkout is coming
  soon".
- `src/server/entitlements.ts`: `getOrgModuleStates(orgId)` returns `{ devAllowAll, modules: ModuleState[] }`,
  `ModuleAccess = 'active' | 'trial' | 'grace' | 'locked' | 'dev'`.
- Entry points into billing: top nav in `(app)/layout.tsx`, `features/shell/user-menu.tsx`,
  `features/shell/command-palette.tsx` (locked apps go to `/billing?module=<m>`), quick link on the launcher,
  locked `ProductTile` goes to `/billing/upgrade?module=<m>`, `AppSwitcher` locked rows go to
  `${portal}/billing`.

Gaps (these break the copy rules and the owner's bar as they stand):
- "coming soon" dead ends in `billing/page.tsx` and `checkout-gate.tsx`.
- Period end copy "Trial, no end date set" and "Manual grant, no renewal".
- Any member can open `/billing`; there is no owner or admin rule for who may change the plan. The upgrade gate
  only lets the `owner` role through; `admin` is treated as a plain member there, while onboarding actions allow
  owner or admin. Pick one rule.
- No invoices, payment method, seat or warehouse count, interval switch, cancel, resume or tax fields.
- Module names and taglines are copied in four places: `billing/page.tsx` `MODULE_NAMES`,
  `billing/upgrade/page.tsx` `UPGRADE_COPY`, `(app)/page.tsx` `PRODUCTS`, `command-palette.tsx`, and again in
  `packages/ui/src/app-switcher/app-switcher.tsx` `APPS`.
- Em dashes appear in portal code comments only. A grep of `apps/portal/src/**/*.tsx` found none in rendered
  UI copy. There is no lint rule for it in the portal (Pulse
  has one, see section 12).

### Launcher and shell
- `src/app/(app)/layout.tsx` `AppLayout`: sticky top bar (logo, `OrgSwitcher`, nav Apps, Billing, Organization,
  `CommandPalette`, `AppSwitcher`, `ThemeToggle`, `UserMenu`), `max-w-[1120px]` main. The nav is hidden below
  `sm`; on a phone Billing is reachable only through the user menu and the command palette.
- `src/app/(app)/page.tsx`: greeting, `SetupGuide`, `ProductTile` grid, `PulseAttentionPanel`,
  `CustomerWorkPanel`, org glance strip, quick links, and a dev note "Every module is unlocked on this
  environment."
- `src/features/launcher/product-tile.tsx`: `ACCESS_BADGE` per `ModuleAccess`; grace shows the period end.
- `src/app/(app)/settings/organization/`: `page.tsx`, `org-profile-form.tsx`, `invite-member-form.tsx`,
  `member-rows.tsx` (`MemberRow`, `InvitationRow`), `leave-org-card.tsx`. Uses Better Auth org endpoints from
  the client. No link between member count and seats.

## 8. Marketing site (`apps/web`)

- `src/lib/pricing.ts` (the one catalog today): `PRICING` (CRM 2900 cents per user, WMS 34900 per warehouse,
  Projects 1200 per user, Pulse 2900 flat per org with `includedSeats: 5` and `isConfirmed: true`,
  `bundleDiscount: 0.2`, `annualDiscount: 0.15`), `PRICING_IS_PLACEHOLDER = true`, `priceOf`, `isPerSeat`,
  `includedSeatsLabel`, `moreSeatsPrompt`, `overSeatsNote`, `preliminaryPriceNote`, `quote(input)`, `isBundle`,
  `todayPrice`, `todayPriceNote`, `formatUsd`, `percentLabel`; types `Billing = 'monthly' | 'annual'`,
  `QuoteInput`, `QuoteLine`, `Quote`. Tests in `src/lib/pricing.test.ts`.
- Consumers: `app/products/page.tsx`, `components/contact/contact-model.ts`, `components/product/cta.tsx`,
  `components/product/price-band.tsx`, `components/products/products-sections.tsx`,
  `components/pulse/pulse-section-bundle.tsx`, `components/stak/bundle-calculator.tsx`,
  `components/stak/stak-parts.tsx` (`QuoteSummary`, `StakVisual`), `components/wizard/*`,
  `components/licensing/licensing-plans.ts`.
- `src/components/site-links.ts`: `LINKS` (prod origins, hard coded), `ROUTES`, `PRODUCT_IDS`, `Stack`,
  `parseStack`, `stackParam`, `getStartedHref`, `startLink`, `walkthroughHref`, `PULSE_IS_LIVE = false`,
  `isAppLive`, `startableStack`, `COMING_SOON`, `CONTACT` (placeholder).
- Get started wizard: `src/app/get-started/page.tsx`, `src/components/wizard/stak-wizard.tsx`,
  `use-stak-wizard.ts`, `wizard-steps.tsx`, `wizard-summary.tsx`, `account-step.tsx`, `ready-view.tsx`, model in
  `src/lib/stak.ts` (`STEP_IDS = stack, business, shape, launch, account`, `StakAnswers`, `setupPlan`,
  `handoffUrl(answers)`, `portalFocus`, `parseAnswers`, `applyPrefill`, `wizardHref`). Tests in `stak.test.ts`.
- Hand off: `ReadyView` renders `<a href={handoffUrl(answers)}>Create your sign-in</a>`, which is
  `${LINKS.portal}/signup?focus=&products=&businessType=&teamSize=&startMode=`.
- Styling is CSS modules plus `src/styles/globals.css` on the shared tokens. It does not use Tailwind or the
  portal components. `next.config.ts` has no env reads; the site is fully static with no env vars on Vercel.

Gaps and bugs:
- The catalog lives inside an app, so the portal cannot import it. It has to move to a package (for example
  `packages/billing` or a `pricing` export) that both `apps/web` and `apps/portal` consume, with `apps/web`
  adding it to `transpilePackages`. `PRODUCT_IDS` and `Stack` live in `site-links.ts` and would move or be
  re-exported with it. Keep `PRICING_IS_PLACEHOLDER` and `isConfirmed` in code comments and flags only.
- `formatUsd` rounds to whole dollars and `quote` rounds each discount to cents. Example: Pulse plus CRM for one
  user, yearly: list $58.00, bundle 20% gives $46.40, yearly 15% gives $39.44 a month, shown as "$39". A
  checkout page and an invoice must show exact cents, and the Stripe amount must equal the quoted amount to the
  cent. Decide where rounding happens (per line or on the total) once, in the catalog.
- "15% off yearly" is expressed as a monthly figure "billed yearly". Checkout needs the yearly charge
  (monthly times 12) stated plainly.
- The site prints "Preliminary pricing, shown for planning." beside CRM, WMS and Projects prices
  (`preliminaryPriceNote`). The decision for this effort is that customers see clean prices.
- `PULSE_IS_LIVE = false` hides Pulse from every start link and from the hand off, yet Pulse is the one product
  with a confirmed price and a launched app (commit `5d3e1a7`). Selling Pulse through signup needs this flag
  flipped (README: "Set this to true on the day pulse.kitstak.app opens").
- `LINKS.portal` is hard coded to production, so the wizard cannot hand off to a local portal. A local end to
  end test needs an env override (for example `NEXT_PUBLIC_PORTAL_URL`) plus the port fix from section 1.
- `AccountStep` says "You will choose a password on the next screen" and `ReadyView` says "Create your
  sign-in"; the portal form then asks for name, email and company again.
- The `guided` add on (founder led setup) has no price and no hand off.
- Team size presets map to seats 1, 5, 25, 60; Pulse covers 5 seats and has no price above that
  (`overSeatsNote` sends people to the contact page).

## 9. Shared UI and theme

- Tokens: `packages/ui/src/styles/tokens.css` (858 lines). Light in `:root`, dark in `:root[data-theme='dark']`
  and a `prefers-color-scheme` block. Families: `--surface-*`, `--text-*`, `--border-*`, `--primary*`,
  `--success*`, `--warning*`, `--danger*`, `--info*`, `--label-<color>*`, `--brand-red`, `--brand-navy`,
  `--brand-oxblood`, `--brand-cream`, `--radius-*`, `--elevation-*`, `--duration-*`, `--ease-*`,
  `--control-height-*`, `--type-*`, `--z-*`, `--font-ui`, `--font-display` (Bebas Neue), `--font-mono`.
- Portal Tailwind mapping: `apps/portal/src/styles/globals.css` `@theme inline` gives utilities such as
  `bg-app`, `bg-panel`, `bg-sunken`, `text-fg`, `text-fg-secondary`, `text-fg-muted`, `border-border-default`,
  `bg-primary`, `text-primary-fg`, `bg-success-subtle`, `text-warning-text`, `shadow-xs`, `outline-focus`.
  Keyframes `ks-fade-in`, `ks-pop-in`, `ks-step-in`, `ks-check-pop`, `ks-confetti-fall`, and the `.auth-hero`
  panel. Dark variant keys off `[data-theme='dark']`.
- `@kitstak/ui` exports: `AppIcon` (`./app-icon`), `AppSwitcher` (`./app-switcher`, props `current`, `urls`,
  `entitled`, `notInPlan`), `Logo`, `LogoMark`, `KITSTAK_SITE_URL` (`./logo`), theme constants and
  `THEME_INIT_SCRIPT`, `extractThemeHandoff`, `persistTheme` (`./theme`), `ThemeHandoff`, `withThemeParam`
  (`./theme-handoff`), `HandoffScreen`, `HandoffPanel`, `useHandoff` (`./handoff`), `StatusIcon`,
  `displayText`, `greetingFor`, `useGreeting`.
- Portal primitives in `apps/portal/src/components/ui/`: `Button` and `buttonVariants` (sizes `sm`, `md`, `lg`;
  `loading`, `fullWidth`, `leadingIcon`, `trailingIcon`), `Input`, `Field`, `inputSurface`, `Checkbox`, `Badge`
  (tones `success`, `info`, `warning`, `neutral`), `Kbd`, `Spinner`, `DropdownMenu*`, `BrandLoader`, `cn`.
- Feature components worth reusing: `features/launcher/app-mark.tsx` `AppMark`, `features/welcome/option-tile.tsx`
  `TileGroup` and `PillGroup` (arrow key friendly radio tiles), `features/setup/progress-ring.tsx`,
  `features/setup/confetti.tsx` (hidden under reduced motion), `(auth)/_components/form-parts.tsx`.

Gaps:
- The portal has no dialog, sheet, tabs, toast, tooltip, select, radio group, switch, table or skeleton
  primitive. The CRM has them in `apps/crm/src/components/ui/` and is the documented source to adapt from. A
  cancel confirmation, a plan picker and an invoice table all need some of these.
- The marketing site and the portal share tokens but not components, so a shared price summary has to be either
  pure data from the catalog package or two renderings of it.

## 10. Env handling

- Per app `.env.local` only; never a root `.env`. Each app has `.env.example`. The portal validates through zod
  (`apps/portal/src/server/env.ts`), lazily, so `next build` works without secrets. Follow that: Stripe keys
  must be optional in the schema and read at call time.
- Shared across apps: `BETTER_AUTH_SECRET` (same value everywhere), `DATABASE_URL`, `TRUSTED_ORIGINS`,
  `AUTH_COOKIE_DOMAIN`, `ENTITLEMENTS_DEV_ALLOW_ALL`, `NEXT_PUBLIC_*_URL`.
- Blueprint names for Stripe (section 3.1): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_CRM_MONTHLY`, `STRIPE_PRICE_WMS_MONTHLY`, `STRIPE_PRICE_BUNDLE_MONTHLY`,
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, held by the portal only. The blueprint's three fixed prices do not fit
  the current catalog (four products, per user and per warehouse quantities, a 20% bundle discount, yearly).
- `deploy/push-env.mjs` builds each Vercel project's variable list from `deploy/secrets.env` (git ignored) and
  pushes `ENTITLEMENTS_DEV_ALLOW_ALL=1`. It has no Stripe entries. `docs/DEPLOYMENT.md` documents the tables.
- Local database: `pnpm --filter kitstak-crm db:start` runs embedded Postgres on `127.0.0.1:5544`
  (`postgres://postgres:postgres@127.0.0.1:5544/kitstak`), then CRM `db:migrate`, `db:seed`, then
  `pnpm --filter @kitstak/db db:migrate`.

## 11. Tests

| Where | Runner | Notes |
|---|---|---|
| `apps/portal` | vitest, `vitest.config.mts`, node env, `src/**/*.test.ts` | 3 files: `lib/routes.test.ts`, `lib/setup-model.test.ts`, `lib/password-rules.test.ts`. **No Playwright, no component tests, no `.tsx` tests.** |
| `packages/entitlements` | vitest | `read.test.ts`, `grant.test.ts` |
| `packages/ui` | vitest with jsdom 31 | app icon, theme, text |
| `apps/web` | vitest | `pricing.test.ts`, `stak.test.ts`, claims and placement tests |
| `apps/crm` | vitest plus Playwright (`playwright.config.ts`, `e2e/`, `global-setup.ts`, scripts `e2e` and `test:e2e`) | |
| `apps/wms` | vitest plus Playwright (`test:e2e`, project `e2e`) | |
| `apps/projects`, `apps/pulse` | vitest plus Playwright (`e2e/*.spec.ts`, script `e2e`) | Pulse config: tests hit a dev server that is already running, `E2E_BASE_URL`, `E2E_CHROMIUM`, 1440 by 900 |
| `packages/pm-bridge`, `packages/pulse-bridge` | vitest, `*.db.test.ts` need a database | |

Root: `pnpm test` (turbo `test`), `pnpm typecheck`, `pnpm lint`, `pnpm build`; turbo has an `e2e` task with no
cache. Shared defaults in `packages/config/vitest/base.ts` (`coverageThresholds` 80, 80, 75,
`sharedTestOptions`). The portal needs a Playwright setup of its own for signup and checkout; copy the Pulse
config.

## 12. Deploys and the commit tag

- Six Vercel projects, one repo, told apart by Root Directory. Each app's `vercel.json` sets
  `"ignoreCommand": "bash ../../deploy/vercel-ignore.sh"`.
- `deploy/vercel-ignore.sh`: a commit message containing **`[skip deploy]`** skips every build. Otherwise
  `npx turbo-ignore --fallback=HEAD^1` builds an app only when it or a package it depends on changed.
- Recent history shows the habit: docs, critic verdicts and in progress fix rounds are committed with
  `[skip deploy]` (`7c82dba`, `bf264ed`, `74c8700`, `005ff9c`, `f530230`); the final squash to main is not.
- Migrations are not automatic for `@kitstak/db`, Projects or Pulse: run them by hand with
  `node deploy/with-prod-db.mjs pnpm --filter @kitstak/db db:migrate` before the deploy that needs them. The CRM
  runs its own in `scripts/vercel-build.sh`.
- A Stripe webhook needs a stable public URL: `https://kitstak.app/api/...` on the portal project.
- A change to `packages/entitlements` or `packages/db` rebuilds all five product apps.

## 13. How `docs/pulse` was specified and reviewed

- `docs/pulse/SPEC.md` (1445 lines): product and build spec. Opens with the copy rule and a table of words used
  on screen, then topology, data model, every screen, states, and acceptance checks.
- `docs/pulse/CONTRACTS.md` (1317 lines): folder ownership per agent lane, function names, DTOs, numbered rules.
- `docs/pulse/research/competitors.md` (226 lines): the competitor baseline the critics score against.
- `apps/pulse/AGENTS.md`: house rules (data access through domain functions, money as bigint cents, routes
  through builders, copy rule, no placeholders or dead buttons, every empty state teaches).
- Copy rule enforcement: `apps/pulse/eslint.config.mjs` plus `apps/pulse/src/lib/copy-rules.test.ts`.
- Critic rounds: `docs/archive/pulse-reviews/round-1-critics.json` to `round-5-critics.json`. Each file is an array of three
  verdicts from three lenses: a buyer (VP of Operations), a principal product designer, and a staff engineer.
  Each verdict has `lens`, `overall_score_0_100`, a competitor baseline score, `pulse_is_better_product`,
  `wowed`, `category_scores` (10 categories with scores for both products and evidence), `blocking_issues`
  (`title`, `where`, `repro`, and a fix), `best_things`, `verdict_paragraph`, and from round two
  `round_N_issues_rechecked` and `what_would_wow_me`. Critics tested the running app with Playwright at 390,
  768 and 1440 wide, light and dark, and quoted exact numbers.
- Scores moved from 84, 83, 76 in round one to 94, 94, 90 in round five; two of three critics were wowed. Each
  round was a fix commit plus a verdict commit, both tagged `[skip deploy]`.
- The same shape fits this effort: `docs/billing/SPEC.md`, `docs/billing/CONTRACTS.md`,
  `docs/billing/research/*`, and `docs/billing/round-N-critics.json`.

## 14. Gaps and bugs, ranked

Blocking for a real signup and billing flow:
1. No Stripe code, dependency, env, route or webhook exists. Billing pages are "coming soon" stubs.
2. Trials cannot expire: `isEntitled` ignores `periodEnd` for `trialing`
   (`packages/entitlements/src/read.ts`).
3. No writer can store a trial end, seats, or Stripe ids (`packages/entitlements/src/grant.ts`), and the
   existing writer overwrites `source`.
4. Nothing starts a trial when an org is created; org creation happens in the browser in three places.
5. The portal drops every hand off value from the marketing wizard (`apps/portal/src/app/(auth)/signup/page.tsx`).
6. The price catalog is inside `apps/web` and cannot be imported by the portal.
7. Production runs with `ENTITLEMENTS_DEV_ALLOW_ALL=1`; going live needs a backfill of grants or trials before
   that value is removed.
8. No email of any kind (verification, reset, invite, trial ending, payment failed).
9. Schema is too thin for a billing page (interval, cancel at period end, quantities, invoices, payment method)
   and `billing_events` has no status or org.

Serious:
10. The dev switch means different things in the portal and in the four product apps (section 5).
11. Entitlement cache: up to 60 seconds of stale lock in the other apps after checkout.
12. Lock screens differ per app and know nothing about trial ended or past due; CRM and WMS drop `?module=`.
13. Whole dollar rounding in `formatUsd` and per step rounding in `quote` (cents lost on screen).
14. `PULSE_IS_LIVE = false` keeps the one confirmed price out of signup.
15. Dev port clash: `apps/web` and `apps/projects` both use 3400. `LINKS.portal` is hard coded to production.
16. Owner versus admin: the upgrade gate allows only `owner`; onboarding actions allow owner or admin.
17. Unlimited org creation allows trial farming.
18. `Permissions-Policy: payment=()` in the portal blocks wallet buttons for any embedded payment UI.
19. Org deletion cascades billing rows with no Stripe cancel.
20. No portal Playwright setup; no CI.

Smaller:
21. Drizzle CHECK literal for modules lists three, not four (`packages/db/src/schema/core/billing.ts`).
22. `focus` only models CRM and WMS; Projects only and Pulse only signups have no focus.
23. Auth hero preview shows two of four apps.
24. Product names and taglines are duplicated in five files.
25. The portal has no dialog, tabs, toast, select or table primitives.
26. No forgot password, terms or privacy links on the portal auth pages.
27. WMS already owns the word "billing" for 3PL client billing.
28. BLUEPRINT.md domains (`kitstak.io`) and the three price env names are out of date.
29. No lint rule for the dash copy rule outside Pulse.
