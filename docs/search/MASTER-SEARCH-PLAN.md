# Portal master search

## Note

Turn the Portal search bar into one search for everything the org has: CRM, WMS, Projects and Pulse.
That means documents, orders, projects, jobs, people, customers, deals, SKUs and so on.
It should learn from each person: what they search for and click often moves to the top, and the
empty search box suggests what they will probably want next.

## What exists today

| Where | Today | Location |
| --- | --- | --- |
| Portal home | "Search apps..." box that only filters the app tiles | `apps/portal/src/features/launcher/app-launcher.tsx`, `apps/portal/src/lib/app-search.ts` |
| Portal Ctrl/Cmd+K | Commands only: open apps, portal pages, switch org, sign out | `apps/portal/src/features/shell/command-palette.tsx` |
| CRM | Global + shell search | `apps/crm/src/server/services/search.ts`, `shell-search.ts` |
| WMS | Global search in the layout | `apps/wms/src/components/layout/global-search.tsx`, `apps/wms/src/server/search` |
| Projects | Quick + full search | `apps/projects/src/server/domain/search.ts`, `search-full.ts` |
| Pulse | Search page + API | `apps/pulse/src/server/domain/search.ts` |
| Cross-app | Projects and Pulse already search CRM/WMS records for link pickers | `apps/projects/src/server/integrations/*`, `apps/pulse/src/server/integrations` |

All apps share one Postgres. WMS data lives in a per-org schema (`@kitstak/db/wms-tenants`).
Every app already knows how to search its own records with its own permission checks.

## Design

### 1. Federated search (each app answers for itself)
The Portal sends the query to every app the org is entitled to, in parallel, and merges the results.
Each app stays the only judge of what a person may see, so nothing leaks across permissions.

- Shared contract in a new `packages/search` package:
  ```ts
  interface SearchHit {
    app: 'crm' | 'wms' | 'projects' | 'pulse' | 'portal';
    type: string;          // 'order' | 'deal' | 'project' | 'job' | 'person' | 'document' | ...
    id: string;
    title: string;
    subtitle?: string;     // "Order #1042 · Acme · Shipped"
    url: string;           // deep link, opened with the theme handoff
    score: number;         // 0..1 text match from the app
    updatedAt?: string;
  }
  interface SearchProvider {
    search(ctx, q: string, opts: { limit: number; types?: string[] }): Promise<SearchHit[]>;
  }
  ```
- Each app adds a `GET /api/v1/portal-search?q=` endpoint that wraps its existing search service.
  The Portal calls it server side with a short lived signed token (user id, org id, 30s expiry).
- Per-app timeout (about 400ms). Slow or down apps are skipped and shown as "WMS didn't answer".
- Results stream into the palette as each app replies.

### 2. Personal ranking (the "smart" part)
New tables in the core schema:

- `core.search_event`: user, org, query, picked app/type/id, position clicked, time.
- `core.search_affinity`: rolled up per user: record frecency (how often + how recently picked),
  type weights (e.g. this person mostly opens orders), and top query prefixes.

Final score per hit:
```
final = text_score * 0.55
      + record_frecency * 0.25   // picked this exact record before
      + type_affinity * 0.12     // picks this kind of thing often
      + recency_of_update * 0.08
```
Weights live in one config so we can tune them from analytics.

Predictive behavior:
- **Empty box**: "Recent" (last picked records) and "Suggested" (highest frecency, plus items assigned
  to them today across apps, e.g. due tasks, open orders).
- **Typing**: prefix completions from their own past queries first, then org wide popular ones.
- **Shortcuts**: learn query to record pairs, so typing "acme" jumps straight to the Acme record they
  always open, shown as the top hit with Enter to open.
- Frecency decays (half-life around 14 days) so old habits fade.
- Privacy: history is per user only, viewable and clearable in Portal settings ("Clear search history").
  Never shared with teammates. Events older than 180 days are deleted.

### 3. UI
- One component, `MasterSearch`, used by the home search box and the Ctrl/Cmd+K palette.
- Groups: Top hit, then per type (Orders, Projects, Jobs, People, Documents...), each with an app badge.
- Filters as chips or prefixes: `order:`, `project:`, `@person`, `in:wms`.
- Keyboard first: arrows, Enter opens, Cmd+Enter opens in a new tab, Tab cycles groups.
- Existing commands (open app, switch org, sign out) stay and rank alongside records.

### 4. Later: shared index for speed
If fan-out gets slow, add `core.search_document` (tsvector + `pg_trgm`) that each app keeps up to date
through its existing event outbox. Permission checks still run in the owning app on the final results.
Only do this if fan-out p95 goes over about 600ms.

## Plan

1. **Contract + Portal shell**
   - Create `packages/search` (types, signed token helpers, merge + rank functions with unit tests).
   - Build `MasterSearch` in the Portal; wire it into the home box and the Ctrl/Cmd+K palette.
2. **Providers**, one app at a time, each behind its entitlement:
   - Projects: projects, tasks, documents, people.
   - CRM: deals, accounts, contacts.
   - WMS: orders, work orders, receipts, SKUs, clients.
   - Pulse: jobs, customers.
3. **Personalization**
   - Migration for `search_event` + `search_affinity`; log picks; nightly rollup job plus live update on pick.
   - Recent, Suggested and prefix completions; settings page to view and clear history.
4. **Polish**
   - Filters/prefixes, timeouts and partial results, a11y, phone layout.
   - Analytics: `search_query`, `search_pick` (position, app, type), zero result queries.
   - E2E: an org with all four apps; a user without WMS access must never see WMS hits.
5. **Optional**: shared index (section 4) if latency needs it.

## Open questions

- Should the same master search replace the per-app Ctrl/Cmd+K search inside CRM, WMS, Projects and Pulse too?
- Which document types count first (Projects attachments, WMS BOL/labels, CRM files)?
- Is AI style natural language ("orders for Acme shipped last week") wanted in v1, or later?
