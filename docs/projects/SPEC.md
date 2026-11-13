# KitStak Projects: product + build spec

The fourth KitStak app: a project management system that rivals Asana, Linear, Monday, ClickUp
and Jira, and is simple enough for an 8th grader. Runs standalone or bundled with Portal/CRM/WMS.

## Topology

| | Dev | Prod |
|---|---|---|
| App | `apps/projects` (npm `kitstak-projects`), `http://localhost:3400` | `projects.kitstak.app` (Vercel project `projects`) |
| DB | shared Postgres, new schema **`pm`** | same Supabase DB |
| Auth | same Better Auth via `@kitstak/auth` (copy portal's `src/server/auth.ts` pattern; cookie `kitstak.session_token`) | `AUTH_COOKIE_DOMAIN=.kitstak.app` |
| Entitlement module | `projects` (add to `core.entitlements` CHECK, `@kitstak/db` schema, `@kitstak/entitlements` MODULES) | |

Local dev DB (already migrated + seeded): `postgres://postgres@localhost:5432/kitstak`.
Shared `BETTER_AUTH_SECRET` is in `/var/lib/kspg/secret`; every app has `.env.local` (gitignored).
Logins: `admin@kitstak.io` / `KitStak-Demo-2026!` (org `kitstak`), `maya@northwind-robotics.example` / `Northwind-Demo-2026!` (org `northwind-robotics`).
Start Postgres if down: `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/kspg/data -l /var/lib/kspg/log -o '-p 5432 -k /tmp' start"`.

## Stack (match portal + CRM exactly)

Next.js 16.4.5 App Router (read `node_modules/next/dist/docs/` first: this Next has breaking changes; `proxy.ts` not middleware), React 19.3, Tailwind 4 via `@tailwindcss/turbopack`, `@kitstak/ui` tokens.css + theme + logo + app-switcher, Drizzle + pg via `@kitstak/db/client-pg`, zod 4, lucide-react, radix, cmdk, `@dnd-kit/*` (CRM uses it), vitest. Look and feel MUST match CRM/portal: same tokens, typography, density, sidebar shell, top bar with app switcher, org switcher, user menu, theme toggle, command palette (Cmd+K).

## Data model (`pm` schema, org-scoped by `core.organization.id`, uuid PKs, timestamptz, soft delete)

- `pm.spaces` (team/department grouping, color, icon)
- `pm.projects` (space, name, key e.g. `OPS`, description rich text, status: planning/active/on_hold/completed/archived, health: on_track/at_risk/off_track, owner, start/due, color, icon, `crm_customer_id` -> core.customers, `crm_item_id` (CRM deal/account item), `wms_ref` jsonb, template flag, archived_at)
- `pm.project_members` (role owner/editor/commenter/viewer)
- `pm.statuses` (per-project workflow columns: name, category todo/in_progress/done/cancelled, color, position)
- `pm.sections` (list grouping)
- `pm.tasks` (project, number per project -> `OPS-42`, title, description, status_id, priority urgent/high/medium/low/none, assignee, reporter, start_date, due_date, estimate_points, estimate_minutes, parent_task_id (subtasks), position (fractional string rank), milestone flag, completed_at, labels, custom field values jsonb, `links` to CRM/WMS)
- `pm.task_dependencies` (blocks / blocked_by)
- `pm.labels`, `pm.task_labels`
- `pm.custom_fields` (text/number/select/multiselect/date/person/checkbox/currency/url)
- `pm.comments` (markdown, @mentions, reactions), `pm.attachments`
- `pm.activity` (immutable audit/event log: who did what, before/after)
- `pm.time_entries` (timer + manual)
- `pm.notifications` (inbox: mention, assign, due soon, status change, comment) + `pm.watchers`
- `pm.milestones`, `pm.goals` (OKR style with key results + progress rollup from projects)
- `pm.saved_views` (per project/user: type board/list/table/timeline/calendar/workload + filters/sort/group JSON)
- `pm.automations` (trigger -> conditions -> actions, "When status changes to Done, notify owner")
- `pm.templates` (project templates: Product launch, Client onboarding, Warehouse go-live, Sprint, Event, Marketing campaign)
- `pm.integration_links` (task/project <-> `crm_item` | `crm_account` | `core_customer` | `wms_order` | `wms_work_order` | `wms_receipt` | `wms_count` with cached title/status/url)
- `pm.forms` (intake form -> creates task)

Migrations live in `apps/projects/drizzle` with its own runner (pattern: `packages/db/scripts/db-migrate.ts`, own table `drizzle.__kitstak_projects_migrations`, enable RLS on every table, never `drizzle-kit push`). Entitlement CHECK change goes in a new `packages/db/drizzle` migration.

## Product surface (all must be real, working, persisted)

1. **Home / My Work**: greeting, today/overdue/upcoming, my tasks across projects, recent projects, inbox preview, quick add.
2. **Inbox** (notifications) with read/unread, archive, filters.
3. **Projects directory** (portfolio): cards + table, health, progress, owner, due, filters; create from blank or template (wizard).
4. **Project views** (tabs, each saveable): Overview (description, health, milestones, progress, members, linked CRM/WMS), **Board** (drag between status columns, swimlanes by assignee/priority, WIP counts), **List** (grouped sections, inline edit, drag reorder, multi-select bulk edit), **Table** (spreadsheet: columns incl. custom fields, sort/filter/group, inline edit), **Timeline/Gantt** (bars drag/resize, dependencies arrows, milestones, today line, zoom day/week/month), **Calendar** (month/week, drag to reschedule), **Workload** (per assignee capacity), **Files**, **Activity**.
5. **Task detail** (side drawer + full page, URL addressable `/p/OPS/42`): title, rich description, status, assignee, dates, priority, labels, custom fields, subtasks with progress, dependencies, attachments, comments with @mentions + reactions, activity history, time tracking timer, watchers, CRM/WMS links, copy link, duplicate, move, delete with undo.
6. **Quick add everywhere** with natural language ("Call Acme tomorrow !high @maya #sales").
7. **Command palette** Cmd+K (navigate, create, search tasks/projects), keyboard shortcuts (`c` create, `/` search, `j/k` navigate, `?` help sheet).
8. **Goals** (OKRs) with progress rollups. **Dashboards/Reports**: burndown/burnup, velocity, status distribution, overdue, workload, cycle time; portfolio rollup.
9. **Automations** builder (8th-grader simple sentences), **Templates**, **Intake forms**.
10. **Search** global; **filters** builder; **bulk actions**; **undo** toasts; optimistic UI; realtime-feeling refresh.
11. **Settings**: project settings (statuses workflow editor, labels, custom fields, members), workspace settings, notifications prefs.
12. **Onboarding**: first-run guided tour + empty states that teach, sample project, helpful tooltips. Plain language everywhere.
13. Responsive (works on phone), accessible (keyboard, ARIA, focus rings, contrast), light/dark.

## Integrations (deep, two-way, graceful when a sibling app is not licensed)

- **CRM**: link a project to a CRM account/deal (picker that reads `crm` schema items for the org); "Create project from deal" (button in CRM item panel -> opens Projects with prefilled template); CRM item panel shows linked projects/tasks + progress; task chips show live CRM item status.
- **WMS**: link tasks to WMS orders, work orders/kitting jobs, receipts, counts (read `wms` schema directly via shared DB); WMS order/work-order pages show "Project tasks" panel + "Create task"; templates like "Warehouse go-live" and "Client onboarding" pull the `core.customers` client.
- **Portal**: launcher tile "KitStak Projects", setup-guide steps, product stats (open tasks, projects at risk), command palette entry.
- **App switcher** (`packages/ui/src/app-switcher`): add `projects` app (id, name "KitStak Projects", descriptor "Projects, tasks and timelines", icon); every app passes its URL + entitlement.
- Shared customers: `core.customers` picker. Shared people: `core.member` of the active org.
- Integration reads go through `apps/projects/src/server/integrations/{crm,wms}.ts` with feature detection (if schema/table absent or not entitled, hide UI, never crash).

## Quality bar

Typecheck + lint clean, vitest unit tests for domain logic (NL quick-add parser, rank ordering, rollups, automations engine, permission checks), Playwright e2e smoke. Every button does something. No placeholder pages, no lorem ipsum, no TODOs. Seed script `pnpm --filter kitstak-projects db:seed` creates rich realistic data for both seeded orgs (spaces, ~8 projects, ~150 tasks, comments, goals, automations, CRM + WMS links to the real seeded CRM/WMS rows).
