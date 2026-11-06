# KitStak CRM — Architecture Contract

This file is the shared contract for every agent working on this repo. Read it before writing code.
Product goal: an enterprise CRM / work-OS whose boards, pills, wizards, sub-pages, menus and navigation
match or beat the current monday.com CRM in a blind side-by-side comparison. Original brand ("KitStak"),
original visuals. Never copy monday.com logos, names, illustrations or assets. Matching UX patterns is fine.

## Stack (fixed)
- Next.js (latest stable, App Router, `src/` dir), React 19, TypeScript `strict`.
- Tailwind CSS v4 with design tokens as CSS variables in `src/styles/tokens.css` (light + dark).
- UI primitives: Radix UI (popover, dropdown-menu, dialog, tooltip, tabs, scroll-area, context-menu) wrapped in `src/components/ui/*`.
  Icons: `lucide-react`. Motion: CSS transitions + `motion` (framer) only where needed.
- Data: PostgreSQL via **embedded-postgres** for local dev (`npm run db:start`, port **5544**, data in `.data/pg`),
  any Postgres via `DATABASE_URL` in prod. ORM: **Drizzle** (`drizzle-orm/node-postgres`), migrations in `drizzle/`.
- Auth: **Better Auth** (email+password, sessions in DB, organization plugin). Every API call is org-scoped.
- Server state: TanStack Query v5. Client UI state: Zustand. Drag & drop: dnd-kit. Virtualization: TanStack Virtual.
- Validation: Zod at every boundary (API input, env, forms). Rich text: Tiptap.
- Tests: Vitest (unit/integration), Playwright (e2e + screenshots, `e2e/`).
- Dev server: `npm run dev` on **port 3100**. Seed: `npm run db:seed` (demo org, users, full CRM workspace with realistic data).
- Demo login (seeded, dev only): see `src/server/db/seed/README.md` (credentials live in the seed file, never in UI code).

## Directory ownership (agents only edit what they own; shared files change only via the foundation owner)
```
src/app/                      routes (thin: compose feature components)
  (auth)/                     login, signup, forgot — owner: auth
  (app)/[orgSlug]/...         authenticated app shell + pages
  api/v1/...                  REST route handlers (thin: validate → service → envelope)
src/components/ui/            design-system primitives — owner: foundation/design-system
src/features/<feature>/       one folder per feature, owned by that feature's agent
  shell/ board-table/ cells/ item-panel/ board-views/ board-toolbar/ dashboards/
  wizards/ automations/ crm/ search/ notifications/ admin/ inbox-mywork/ import-export/
src/server/                   backend — owner: foundation/backend
  db/schema/*.ts  db/index.ts  db/seed/
  services/<domain>.ts        business logic (repository pattern), pure + testable
  auth/  rbac/  rate-limit/  audit/  realtime/  automations-engine/
src/lib/                      shared client utils (api client, query keys, formatters)
src/styles/                   tokens.css, globals.css
e2e/                          Playwright specs + screenshot harness
docs/                         this contract, reference research, critic reports
```

## Domain model (Postgres, all tables have `id uuid`, `org_id`, `created_at`, `updated_at`; soft delete via `deleted_at` where noted)
- organizations, members (role: owner|admin|member|viewer|guest), teams, team_members, invitations
- workspaces (org) → folders (nested via parent_id) → boards
- boards: name, kind (`leads|contacts|accounts|deals|activities|projects|custom`), description, icon, privacy (`main|private|shareable`),
  item_terminology ("Deal", "Lead"...), owner ids, deleted_at
- columns: board_id, key (stable string id), title, type, settings jsonb, width, position, hidden
  Column types: `name, text, long_text, status, people, date, timeline, number, currency, email, phone, link, dropdown, tags,
  checkbox, rating, progress, files, connect_boards, mirror, formula, location, country, last_updated, creation_log, item_id, button`
  `status`/`dropdown` settings: `{ labels: [{id, name, color, position, isDone?}] }` — colors from the token palette names.
- groups: board_id, title, color, position, collapsed_default
- items: board_id, group_id, parent_item_id (subitems), name, position (fractional index string), values jsonb `{ [columnKey]: CellValue }`,
  created_by, deleted_at. Index GIN on values. Every write bumps `updated_at` and writes an activity row.
- item_links (connect_boards relations): from_item, to_item, column_key
- updates (comments): item_id, author_id, body (Tiptap JSON + plain text), parent_update_id, pinned, edited_at; update_reactions; update_reads
- files: item_id/update_id, name, mime, size, storage_key (local `.data/uploads` in dev)
- activity_log: board_id, item_id, actor_id, action, column_key, before jsonb, after jsonb
- views: board_id, type (`table|kanban|calendar|timeline|chart|form|dashboard|files`), name, config jsonb (filters, sort, group_by, hidden columns, kanban column, etc.), position, is_default
- dashboards + dashboard_widgets (type, config, layout x/y/w/h)
- automations: board_id, name, trigger jsonb, conditions jsonb, actions jsonb, enabled, run counts; automation_runs (log)
- notifications: user_id, kind, actor_id, item_id, payload, read_at
- favorites, recent_visits, saved_filters, api_tokens (hashed), audit_log (security-relevant org events), webhooks

CellValue shapes (TypeScript, in `src/server/db/schema/cell-values.ts`, shared with client):
`status:{labelId}` `people:{ids:string[]}` `date:{date:'YYYY-MM-DD', time?}` `timeline:{from,to}` `number:number`
`currency:{amount,currency}` `email:{email,label?}` `phone:{phone,country?}` `link:{url,text?}` `dropdown:{labelIds:string[]}`
`tags:{tags:string[]}` `checkbox:boolean` `rating:number` `connect_boards:{itemIds:string[]}` `text:string` `long_text:string`
`location:{address,lat?,lng?}` `files:{fileIds:string[]}` `progress` / `mirror` / `formula` / `last_updated` / `creation_log` are computed.

## API contract
- REST under `/api/v1`, JSON envelope: `{ ok: true, data, meta? }` | `{ ok: false, error: { code, message, details? } }`.
- Every handler: `withApi({ auth:'required', permission:'board:write', rateLimit:'default' }, async (ctx) => ...)` helper from `src/server/api.ts`
  → resolves session, org membership, RBAC, Zod-validates input, rate limits, catches errors, audits sensitive actions.
- Pagination: cursor based `?cursor=&limit=` → `meta.nextCursor`.
- Realtime: `GET /api/v1/stream?boardId=` Server-Sent Events, fed by Postgres LISTEN/NOTIFY; client invalidates TanStack Query keys.
- Client: `src/lib/api.ts` typed fetcher + `src/lib/query-keys.ts`. Mutations are optimistic with rollback + toast on failure.

## Security baseline (non-negotiable)
- Org isolation enforced in services (every query filters by `org_id`); RBAC checks in `withApi`; board-level privacy honored.
- CSRF: Better Auth same-site cookies + origin check on mutating requests. Security headers + CSP in `next.config` / middleware.
- Rate limiting on auth and all mutating endpoints. No secrets in code; env validated with Zod in `src/server/env.ts`.
- Rich text sanitized server-side; file uploads type/size checked; no `dangerouslySetInnerHTML` without sanitization.

## Design language (KitStak) — enterprise, crisp, colorful-but-disciplined
- Font: **Figtree** (UI) + **Poppins** (headings/brand) via `next/font`. Base size 14px, table rows 36px (compact 32 / comfortable 40).
- Neutral surfaces: app background `--surface-app` (very light cool gray), panels white, borders 1px `--border-subtle`.
- Primary `--primary` vivid blue (#0073EA-ish family, but our own tuned scale), hover/active states defined for every interactive element.
- Status palette (label colors, named tokens): green-done, orange-working, red-stuck, gray-default, blue, purple, pink, teal, yellow, dark-blue,
  lime, brown, sky, berry, indigo, peach, + light variants. Status/priority cells are **full-bleed colored pills filling the cell** with white text,
  hover reveals a folded-corner affordance; click opens a label picker popover with "Edit labels".
- Groups: colored group title text + 6px colored left border on every row in the group, collapsible, group footer with column summaries
  (status "battery" bar, number sums, date ranges).
- Motion: 120–200ms ease-out, no jank; skeleton loaders everywhere; optimistic updates; toasts with Undo.
- Every interactive element: hover, focus-visible ring, active, disabled, loading states. Keyboard navigable grid. WCAG 2.2 AA.
- Light theme is primary; dark theme must also look intentional.
