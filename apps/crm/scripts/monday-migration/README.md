# monday.com → KitStak CRM migration (Team1)

One-off migration run on 2026-11-12 against the production platform DB (Supabase
`kitstak-platform`). Kept for reference and re-runs; both scripts are idempotent.

## Scripts

- `provision-team1.ts` — creates the Team1 org (slug `team1`), all 7 human monday
  account members as users (Mike owner + credential login, Bryan admin, Lauren member,
  Franky/Josh/Chris/Tyler viewers), the two workspaces ("Project Tasks" with the
  "Task Keeper" folder, "Product Connections") and memberships. Requires
  `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `TEAM1_ADMIN_PASSWORD`
  (stored in the main checkout's gitignored `deploy/secrets.env`).
  The CRM entitlement is granted separately:
  `pnpm --filter @kitstak/entitlements grant grant team1 crm`.
- `load-extracts.ts` — loads `board-*.json` extract files (produced via the monday.com
  connector, read-only) into the org: boards, columns (status labels with monday label
  ids preserved), groups, items and subitems, people/status/date/timeline/text values.
  A board whose `settings.mondayBoardId` already exists is skipped, so re-runs only add
  new boards. Requires `DATABASE_URL`, auth env vars as above, and `EXTRACT_DIR`.

## What was migrated (2026-11-12)

28 boards, 210 items: 22 client boards from the "Project Tasks" workspace (Task Keeper
folder) and 6 project boards from "Product Connections". The monday "KitStak Reference
Sandbox" workspace was intentionally excluded (design-reference copy, not real data).

## Not migrated (by design)

- **File attachments** — monday-hosted `protected_static` URLs; the extract files keep
  the URLs if a second pass is ever wanted.
- **monday automations** and **views** beyond a default "Main table" view per board.
- **Item update threads** (comments).
- monday AI agent users (Sarah/Richard/Olivia/"Michael" workspace agents).
