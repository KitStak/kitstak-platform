# Agent write access: token API for CRM, Projects and Pulse, and MCP write tools

Status: plan for review (2026-11-27). Owner: platform. Goal: let Claude create and change Team1 records in CRM, Projects and Pulse during the migration, through each app's own rules, from the existing KitStak MCP server (`tools/kitstak-mcp`).

Decided with the user 2026-11-27:

- Writes go through each app's API, never straight to the database. The read-only role stays read only.
- In scope: CRM, Projects (with programs) and Pulse. WMS is out of scope for now.

---

## 0. What exists today

| App | Outside writes today | Auth |
|---|---|---|
| CRM | 113 write route files under `apps/crm/src/app/api/**` (`withApi`) | Cookie session, or a personal API token `Authorization: Bearer ks_live_...` from `crm.api_tokens` (SHA-256 hash, org bound, scopes, expiry, revoke, `last_used_at`). `apps/crm/src/server/services/admin-token-auth.ts`. |
| Projects | 3 write routes. Every other change is a server action: `apps/projects/src/server/actions/*.ts`, each `runAction(zodSchema, input, (data, ctx) => domainFn(ctx, data))`. | Cookie session only (`getApiContext`, `requireActionContext` in `src/server/session.ts`). |
| Pulse | 16 write routes, mostly the CSV import (`/api/v1/import/**`: create, check, commit, undo). Everything else is a server action, same `runAction` shape. | Cookie session only. |

The actions already hold the validation schemas and call the domain layer, which does numbering, activity, ledger refresh, bridge events and the plan gate. The plan reuses them as they are.

Not related: the `logiwa-to-kitstak` and `kitstak-bulk-entry` skills point at a different product (`kitstak.app`, another Supabase project). They are not used here.

---

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| W1 | One platform token, `core.api_tokens`, works in every app. Issued and revoked in Portal settings by the person it belongs to. Format `ks_pat_` plus 32 random bytes base64url; only the SHA-256 hash is stored. The prefix differs from CRM's `ks_live_` so every app can tell the two kinds apart before any lookup. | One token for the MCP, not one per app. Portal is the one app every org has. |
| W2 | A token carries app scopes: `crm:read`, `crm:write`, `projects:read`, `projects:write`, `pulse:read`, `pulse:write`. A write scope does not grant more than the owner's own role: every request still runs the app's normal permission checks as that person. | A token can only ever do what its owner could do in the UI, and less when scoped down. |
| W3 | Tokens are bound to one org, expire (default 30 days, max 90), and can be revoked at once. The token value is shown once at creation. | Migration access should not outlive the migration. |
| W4 | CRM keeps `crm.api_tokens` working and also accepts `core.api_tokens` with a `crm:*` scope, mapped to its existing scope check. | No break for tokens people already made. |
| W5 | Projects and Pulse get one endpoint each: `POST /api/v1/agent/{action}`, token only (no cookie), dispatching to an allowlist of existing actions (section 3). Each entry names the action's own zod schema and domain function. Nothing outside the allowlist is reachable. | Same checks as the UI with no copy of business rules. A new action is opt in. |
| W6 | Every agent write is recorded: the app's normal activity row (actor is the token owner, source `api_token`), plus one `core.api_token_events` row (token, app, action, target ids, ok or error, time). | You can see and undo what the agent did. |
| W7 | No hard deletes through the agent endpoints. Archive, cancel and soft delete actions are allowed where the app has them. | Mistakes during a migration stay recoverable. |
| W8 | Every write action takes `dryRun: true`: it validates and returns what would change, writes nothing. The MCP write tools default to a dry run on the first call of a batch. | Check one before running many, the rule the migration skills already follow. |
| W9 | Rate limit per token: 600 writes a minute per app, and bulk entries count each record. | A loop cannot flood production. |
| W10 | The MCP server keeps its read tools on the read-only database role, and adds write tools that call the apps over HTTPS with the token (`KITSTAK_MCP_API_TOKEN`, app URLs in env). The write tools appear only when a token is set and its scopes include that app's write. Claude Code asks you before each write tool call unless you allow it. | Reads stay fast and safe; writes go through the apps. |

---

## 2. Token service (`@kitstak/db/api-tokens`, built in step 1)

- Migration `packages/db/drizzle/0012_core_api_tokens.sql`: `core.api_tokens` (id, org_id, user_id, name, token_hash unique, token_prefix, scopes text[] with a CHECK on the six scopes, expires_at not null and at most 90 days after created_at, revoked_at, revoked_by, last_used_at, created_at) and `core.api_token_events` (id, token_id, org_id, app, action, dry_run, ok, error_code, target jsonb, at). RLS on with no policies, like every core table.
- `packages/db/src/api-tokens.ts`, raw `sql` over a structural executor like `record-links.ts`, so every app calls it with its own driver:
  - `createApiToken(db, { orgId, userId, name, scopes, days })` returns the token once. Only active members; at most 20 live tokens per person per org.
  - `authenticateApiToken(db, authorizationHeader, { app, level })` returns `{ tokenId, orgId, userId, scopes }` or throws UNAUTHENTICATED or FORBIDDEN. Hash lookup; not revoked, not expired; owner still an active member (no `deactivated:` role) and not switched off (`core.sign_in_blocks`); write implies read. No cache. `last_used_at` at most once a minute, awaited (the pool wedge note in CRM).
  - `listApiTokens`, `revokeApiToken` (owner, or an org owner or admin), `recordApiTokenEvent`.
- Portal: Settings, "API tokens" (`/settings/api-tokens`, also in the account menu): make a token (name, apps the plan includes, read only or read and change, 7 to 90 days) with a sign in from the last 15 minutes, shown once with Copy; list with state, scopes, dates and last use; revoke with a confirm. People see their own tokens; org owners and admins see and revoke everyone's.

## 3. Projects and Pulse agent endpoints

`apps/{projects,pulse}/src/app/api/v1/agent/[action]/route.ts`:

1. Token only: refuse a request with a cookie and no bearer header ("Use an API token for this endpoint.").
2. `authenticateBearer` with the app; require `{app}:write`.
3. Build the app context from the token owner and org (`buildContext` with a session shaped principal, the way CRM builds one), so permissions, plan gate and money visibility are the person's own.
4. Look the action up in `agent-actions.ts`; parse the body with its schema; run its domain function; return `{ data }` or the app's error shape. `dryRun` runs the schema and the domain's own validation in a transaction that is rolled back.
5. Write the `core.api_token_events` row.

Allowlist, first cut (migration needs; each name is an existing action):

| App | Actions |
|---|---|
| Projects | projects: create, update, archive · tasks: create, create many, update, move, set done, comment, add time · structure: statuses, labels, milestones · programs: create (wizard payload), update settings, variants (generate, add, update, retire), price card (save draft, publish), one time charges, schedules, builds (plan, update, cancel), output (log), month close is left out · links: add, remove |
| Pulse | clients, sites, labor classes, labor rates, job types: create and update · jobs: create, update, set status · production and labor log rows: add, update · revenue and cost entries: add, update · import: create, check, commit, undo (the existing CSV import, for history) · link a program |

CRM needs no new endpoint: the MCP calls its existing routes with a `crm:write` token.

## 4. MCP write tools (`tools/kitstak-mcp`)

- New env: `KITSTAK_MCP_API_TOKEN`, `KITSTAK_CRM_URL`, `KITSTAK_PROJECTS_URL`, `KITSTAK_PULSE_URL`. The token lives in `~/.kitstak-mcp/.env`, which you fill in, like the database URL.
- Tools are typed per record, not "run any action": `crm_create_item`, `crm_update_item`, `crm_add_update`, `crm_create_board`, `crm_add_column`, `projects_create_project`, `projects_create_tasks`, `projects_update_task`, `projects_comment`, `programs_create`, `programs_set_variants`, `programs_publish_price_card`, `programs_log_output`, `pulse_upsert_client`, `pulse_create_job`, `pulse_set_labor_rate`, `pulse_import_csv` (create, check, then commit only with `confirm: true`), and so on as the allowlist grows.
- Each tool takes `dry_run` (default true for the first call in a session for that tool) and returns the record ids and links it made.
- Startup: read the token's scopes from Portal (`GET /api/v1/tokens/me`) and offer only the write tools it allows. Refuse to start write tools if the token's org is not `KITSTAK_MCP_ORG`.

## 5. Security review (before merge)

Run the security reviewer on each PR. Points to check:

- No cookie path into the agent endpoints (CSRF).
- Token compare is a hash lookup; the raw token is never logged, stored or returned after creation.
- Cross org: a token for org A gets 404 on org B records, in every app (tests).
- Scope and role both apply: a `projects:write` token of a viewer cannot write.
- Money fields stay hidden for people without money access (Projects A10, Pulse rules).
- Allowlist test: every agent action name maps to an existing action; nothing else answers.
- Revoked and expired tokens fail at once (no cache).

Carried forward from the step 1 security review (2026-11-27), for the app endpoints in steps 2 to 4:

- Each app checks its own plan entitlement on every token request. `authenticateApiToken` checks the token, the person and the scope, not the plan, so an org that loses an app still holds tokens that name it.
- Rate limit by IP before calling `authenticateApiToken`: any well formed `ks_pat_` string costs one database read.
- Changing or resetting a password does not revoke tokens (the usual personal token trade off). Revoke them in Settings, API tokens. Leaving, being deactivated or being switched off does revoke them, for good (0012 triggers).
- `target` in `core.api_token_events` holds ids and counts only, never request bodies.

## 6. Tests

- `@kitstak/db/api-tokens`: issue, authenticate, expire, revoke, scope checks, membership and switch off, the per person limit, `last_used_at` throttle, cross org refusal (done in step 1).
- Projects and Pulse: db tests for each allowlisted action through the agent route (happy path, validation error, permission denied, dry run writes nothing, event row written), and cross org refusal.
- CRM: a core token with `crm:write` works on an item route; with `crm:read` it is refused on a write.
- MCP: tool list follows scopes; dry run default; errors come back readable; end to end on the seed org.

## 7. Build order (each its own PR)

1. `core.api_tokens` and events, `@kitstak/db/api-tokens`, Portal token screen. (Security review.)
2. CRM accepts core tokens. MCP CRM write tools. You can start migrating CRM records here.
3. Projects agent endpoint and allowlist; MCP Projects and program tools.
4. Pulse agent endpoint and allowlist; MCP Pulse tools, CSV import first (history).
5. Turn on for Team1: you create a token in Portal with the scopes you want and paste it into `~/.kitstak-mcp/.env`.

Estimate: steps 1 and 2 are the larger part (new auth); 3 and 4 are mostly the allowlist and tests.

## 8. Not in this plan

- WMS writes.
- A hosted MCP with OAuth sign-in (the read server's README "Later" item). The token approach here is the step before it.
- Deletes, month close and reopen, plan and billing changes, user and role management through the agent.
