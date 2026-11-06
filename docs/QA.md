# KitStak QA Harness & Critic Rubric

This page is for **builders** (feature agents) and **critics** (the reviewers who decide whether a surface is
enterprise grade). Every command runs from the repo root without prompts. Port 3100 is ours, and so is Postgres
on 5544. Never touch 3000, 5432 or 5433: other projects use them.

---

## 1. Get the app running (shared, concurrency-safe)

```bash
npx tsx scripts/ensure-dev.ts            # start DB + dev server if needed, wait for /api/v1/health
npx tsx scripts/ensure-dev.ts --status   # report only (exit 0 = healthy)
npx tsx scripts/ensure-dev.ts --stop     # stop the dev server the harness started
```

- **Safe to run in parallel.** If the server is already healthy, the command returns in under a second. If it isn't,
  one caller takes `.qa/dev.lock` and starts the server while every other caller waits. A lock left by a crashed
  process is reclaimed automatically.
- **Background.** The dev server runs detached as `next dev -p 3100`. Its log is `.qa/dev-server.log` and its pid is
  `.qa/dev-server.pid`.
- **Database.** If nothing is listening on 5544, `npm run db:start` runs first. Set `ENSURE_DEV_SKIP_DB=1` when you
  use an external `DATABASE_URL`.
- **Don't stop a shared server mid-session.** Other agents are probably using it. Run `--stop` only when you are the
  last one, or after you change env or config that needs a restart.
- **Stale dev cache.** Before starting a server, ensure-dev compares a fingerprint (Next version, `next.config.ts`,
  `package-lock.json`, `.next/BUILD_ID` mtime) with `.qa/dev-stamp.json` and wipes `.next/dev` when it changed. A stale
  cache makes every page reload-loop on "HMR hash mismatch". **Never run `npm run build` while the dev server is
  running** (both write `.next`); stop it first, build, then run ensure-dev again.
- **Seeding.** Run `npm run db:seed` if login fails with "invalid email or password". Use `npm run db:reset` for a
  clean slate (local only).

## 2. See the app: screenshots

```bash
npx tsx scripts/screenshot.ts @/                       # the signed-in org home
npx tsx scripts/screenshot.ts @/boards/<id> --theme dark
npx tsx scripts/screenshot.ts /login --no-auth --width 390 --height 844
npx tsx scripts/screenshot.ts @/boards/<id> \
  --action 'click:testid=status-cell' --action 'shot:status-open' \
  --action 'press:Escape' --out board-status.png
```

- **Paths.** A path can be absolute (`/acme/boards/123`), a full URL, or **org-relative** (`@/…`), which is resolved
  by following `/` to the demo admin's org. In Git Bash, prefer `@/…`. Plain `/x` paths also work, because the tool
  undoes MSYS path mangling, but **always quote arguments**.
- **Output.** PNGs go to `.qa/screens/`. The default name is `<path-slug>-<theme>-<w>x<h>.png`, and `--out name.png`
  picks your own. Use a unique `--out` per agent if several of you shoot the same page. The last stdout line is
  `SCREENSHOT <absolute path>`; open that file with your image viewer or Read tool.
- **Auth.** The tool reuses `e2e/.auth/admin.json` and logs in automatically when that file is missing or expired.
  Logins are serialised through `.qa/auth.lock`, and sign-in is rate limited, so don't delete the file needlessly.
- **What it waits for.**
  - DOM content loaded.
  - Network quiet, best effort: SSE streams keep the network busy, so it gives up after 6 s.
  - No `[data-skeleton]`, `[aria-busy="true"]` or `.animate-pulse` left on the page (up to 15 s).
  - Fonts loaded, then two animation frames.
  - The same wait runs again after every action.
  - Animations are disabled and the caret is hidden when it captures.
- **Warnings go to stderr.**
  - HTTP 4xx/5xx responses.
  - Skeletons that never resolved.
  - `console.error` messages and page errors.
  - The **Next.js error overlay**.

  Critics: any warning is a finding.
- **On failure** it retries twice (`--retries`). If every attempt fails, it saves `<out>-error.png` showing the page
  at the moment of failure and exits 1 with the failing step, e.g. `Action #2 "click:…" failed: Timeout…`.
- **Actions** run in order and can be repeated:

  | Action | What it does |
  | --- | --- |
  | `click:` / `dblclick:` / `rightclick:` / `hover:` / `focus:` `<selector>` | Interact with an element |
  | `fill:<selector>=<value>` | Set a field's value |
  | `type:<text>` | Type text |
  | `press:<Key>` | Press a key, e.g. `Control+K` |
  | `waitfor:<selector>` | Wait for an element |
  | `wait:<ms>` | Pause |
  | `goto:<path>` | Navigate |
  | `scroll:<selector \| y>` | Scroll to an element or a y offset |
  | `shot:<label>` | Take an intermediate capture |

  Selectors are Playwright selectors (CSS, `text=…`, `role=button[name="New item"]`), plus `testid=<id>`.
- **Other flags:**
  - `--full-page`
  - `--wait-for <selector>`
  - `--timeout <s>` (per step)
  - `--show-dev-overlay`: keeps the Next dev indicator, which is hidden by default unless an error is showing
  - `--json`
- **Required breakpoints for critics:** 1440×900 (primary), 1024×768, 390×844, each in light **and** dark.

## 3. Tests

| What | Command |
| --- | --- |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Unit/integration (node + jsdom projects) | `npm run test` · `npx vitest run --project node` · `--project dom` |
| Coverage (80% gate on `src/server`, `src/lib`) | `npm run test:coverage` |
| E2E (all) | `npm run e2e` |
| E2E (one spec / grep) | `npx playwright test e2e/smoke.spec.ts` · `npx playwright test -g "opens a board"` |
| E2E report | `npx playwright show-report` (HTML in `playwright-report/`) |

**Vitest file naming:**
- `*.test.ts` runs in **node**.
- `*.test.tsx` and `*.dom.test.ts` run in **jsdom**.
- `@/` resolves to `src/`, and `server-only` is stubbed.

**Playwright behaviour:**
- **Global setup** (`e2e/global-setup.ts`):
  - Runs `ensureDevServer()`, so it reuses or starts the shared server and never stops it.
  - Logs in once as the seeded demo admin and saves `e2e/.auth/admin.json`.
  - If that login fails, logged-out specs still run, and authenticated specs fail fast with the reason.
- **Credentials:** `E2E_EMAIL` / `E2E_PASSWORD` if set; otherwise they are parsed from
  `src/server/db/seed/README.md`. Seed owner: document them as `Email: \`…\`` / `Password: \`…\`` lines or as a
  table with Email/Password columns.
- **Browser:**
  1. Playwright's bundled Chromium, if it is installed.
  2. Otherwise system Chrome/Edge (`channel`).
  3. Otherwise the newest cached `ms-playwright/chromium-*`.

  Override with `PLAYWRIGHT_CHROMIUM_EXECUTABLE` or `PLAYWRIGHT_CHANNEL`.
- **Failure artifacts:**
  - Screenshots on failure.
  - A trace on the first retry (local runs retry once).
  - Video only with `E2E_VIDEO=1`, which needs `npx playwright install ffmpeg`.
- **Fixtures** (`e2e/support/fixtures.ts`):
  - `authedTest`: signed in as admin.
  - `publicTest`: logged out.
  - Both collect `diagnostics.errors` (page errors + `console.error`), and specs assert it is empty.

### Selector & state contract (builders: please implement)

Specs and critics rely on these hooks. Prefer roles and labels. Add `data-testid` where a role is ambiguous.

| Surface | Hook |
| --- | --- |
| App shell root | `data-testid="app-shell"` |
| Left sidebar | `<nav aria-label="Workspace sidebar" data-testid="app-sidebar">` |
| Sidebar board link | `<a href="/<org>/boards/<id>" data-testid="sidebar-board-link">` |
| Board page | `<h1>` = board name; table `role="grid"` + `data-testid="board-table"` |
| Group | `data-testid="board-group"` + `data-group-id` |
| Item row / cell | `role="row"` `data-item-id`; `role="gridcell"` `data-column-key` `data-column-type` |
| Status pill | `data-testid="status-cell"` (button) → picker `role="listbox"` / `dialog` |
| Item panel | `role="dialog"` `aria-label="<item name>"` `data-testid="item-panel"` |
| Loading | skeletons carry `data-skeleton`; busy regions `aria-busy="true"` (both must clear when loaded) |
| Toasts | Sonner (`role="status"`), Undo action as a button named "Undo" |
| Form errors | `role="alert"` near the field, linked with `aria-describedby` |
| Theme | `<html data-theme="light|dark">`. The theme provider should read `localStorage['kitstak.theme']` |

---

## 4. Critic rubric

Critics are deliberately harsh. Score each dimension **0–5**. A surface **ships only if every dimension is ≥ 4** and
the blind comparison (below) prefers KitStak or calls a tie. Report findings as
`SEVERITY · surface · what's wrong · evidence (screenshot path) · expected`. Severities are BLOCKER, MAJOR and MINOR.

| # | Dimension | 5 = enterprise grade | Instant fails (BLOCKER/MAJOR) |
| --- | --- | --- | --- |
| 1 | **Visual polish** | Crisp 1px borders and consistent radii (pills 4px, cards 8px). Icons on the 16/20px grid. Nothing looks unfinished. | Misaligned icons, mismatched radii, unstyled browser controls, default focus outlines, lorem/placeholder text |
| 2 | **Interaction states** | Every control has hover, focus-visible ring, active, disabled and loading states. Pills show a hover affordance. Menus highlight the current row. | Any clickable element without hover or focus feedback. Buttons that can be double-submitted. |
| 3 | **Alignment & spacing rhythm** | A 4px grid. Table rows exactly 36/32/40px. Column text baselines align. Header, toolbar and group spacing is consistent. | Off-by-1–3px drift between rows/cells, uneven gutters, jumping layout on hover |
| 4 | **Typography** | Figtree UI / Poppins headings. A clear scale (12/13/14/16/20/24/32). Truncation with ellipsis + tooltip. Tabular numbers in number/currency cells. | Mixed fonts, orphaned bold, clipped text, unlabeled truncation |
| 5 | **Color semantics** | Status colours mean the same everywhere (done = green, stuck = red, working = orange). White text on pills passes AA. Group colours carry through to the row border and the summary battery. Dark theme is designed, not inverted. | Colour as the only signal, AA contrast failures, inconsistent label colours between table, kanban and charts |
| 6 | **Empty / loading / error states** | Skeletons match the final layout (no CLS). Empty states have an illustration-free, helpful message with a primary action. Errors are recoverable (retry), and optimistic updates roll back with a toast. | Spinners on blank pages, layout shift on load, raw error JSON, dead ends |
| 7 | **Keyboard & a11y** | Full keyboard grid navigation (arrows, Enter to edit, Esc to cancel, Tab out). Focus trapped in dialogs and returned on close. ⌘/Ctrl+K search. Roles and labels on everything. Reduced motion respected. | Keyboard traps, unlabeled icon buttons, focus lost after closing a popover, axe violations |
| 8 | **Performance feel** | Interactions respond in < 100ms (optimistic). Route changes < 300ms after warm-up. Large boards (1k+ items) scroll at 60fps (virtualised). No jank on pill/menu open. | Visible lag on cell edit, full-page reloads for in-app navigation, scroll stutter |
| 9 | **Parity with monday.com CRM flows** | The flows below work end to end with equal or fewer clicks and richer feedback. | A missing flow, more clicks than monday for a core action, a flow that doesn't persist after reload |

**Flows that must reach parity** (critics drive them with `--action` scripts or Playwright):

1. **Navigation.** Sidebar workspace switcher, favorites, search boards, collapse sidebar, breadcrumbs, recent items,
   and ⌘K global search to any item.
2. **Board.** Add an item inline, rename it, and drag to reorder or move between groups. Collapse a group, add a
   group, and check the group colour menu.
3. **Columns.** Add a column from the "+" type picker. Then rename, resize, reorder, hide, sort, filter and
   duplicate it, and change its type.
4. **Pills.** Status/priority label picker. "Edit labels" with colours and a done flag. Multi-select dropdown and
   tags. The people picker with avatars. A date picker with relative shortcuts.
5. **Toolbar.** Search, Person filter, advanced Filter (and/or groups), Sort, Hide, Group by, and saved views.
6. **Item page.** It opens from the row. It has Updates (rich text, @mentions, reactions), Files and an Activity log
   with before→after values, plus subitems.
7. **Views.** Table, Kanban (drag between status columns), Calendar, Timeline/Gantt, Chart, Form (public submit) and
   Dashboard widgets.
8. **CRM.** Leads → qualify → convert to Contact + Account + Deal. A Deals pipeline with forecast amounts and stage
   probability. Activities logged against a contact.
9. **Wizards.** Create board from template, import CSV with column mapping, invite teammates with roles, and build an
   automation ("When status changes to X, notify Y").
10. **Admin.** Members & roles, teams, permissions on a private board, and the audit log.

### Blind side-by-side protocol

1. Capture the same flow in monday.com (the user's sandbox, read-only for existing workspaces) and in KitStak, at
   1440×900 in light theme.
2. Strip the branding from both: crop the logo area, or note "A"/"B" only.
3. The critic judges A vs B on each rubric dimension **without knowing which is which**, then picks the better
   product and writes one paragraph explaining why.
4. A KitStak loss on any dimension sends the surface back to the builder with the concrete findings. The loop
   continues until the critic prefers KitStak or calls a tie on every dimension.

### Critic checklist (per surface, before scoring)

- [ ] Screenshots at all 3 breakpoints × 2 themes, with no stderr warnings
- [ ] Hover, focus and open state captured for every pill and menu (`hover:` / `focus:` / `click:` + `shot:`)
- [ ] Empty board, loading (throttled) and error (API 500) states seen
- [ ] Keyboard-only pass: no mouse, through the primary flow
- [ ] Reload after every mutation: the data persisted
- [ ] `npm run typecheck && npm run lint && npm run test` green; relevant e2e spec green
