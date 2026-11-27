# Projects scripts

| Script | What it does |
|---|---|
| `db-migrate.ts` | Applies the Projects migrations (`pnpm db:migrate`). |
| `shot.mjs` | Signs in and screenshots routes in light and dark (see the header for options). |
| `e2e-programs.mjs` | Runs the Programs end to end flows (docs/programs/SPEC.md 9.3). |

## e2e-programs.mjs

Runs against the dev servers with the seeded Northwind data, signed in as Maya (and as Aisha and
Liam for the money hidden flows). Seed first: CRM, then Projects, then Pulse.

```bash
cd apps/projects
node scripts/e2e-programs.mjs                       # every flow
node scripts/e2e-programs.mjs wizard log-output     # some flows
node scripts/e2e-programs.mjs --base http://localhost:3400 --pulse http://localhost:3500 --crm http://localhost:3100
```

Options: `--base` (Projects), `--pulse`, `--crm`, `--out` (where failure screenshots go, default
`/tmp/claude-0/e2e-programs`). `DATABASE_URL` (default the local database) is read with `psql` to
check what the screens saved.

| Flow | Checks |
|---|---|
| `wizard` | New program from scratch with Paste a list, a card and a weekday schedule; lands on Overview; the toast build count equals the builds made (40 on 2026-11-25). |
| `wizard-deal` | From the won deal "Gripwell Safety Supply · Winter liner add on": Step 0 skipped, the deal value callout, Set prices later. |
| `planner` | Fills the week after next, creates, Undo removes every build. |
| `price-card` | Three variant rate changes make one pending draft, which is then published (before any output today, so it replaces the first version on its start day). |
| `log-output` | `O` opens the log dialog; two scans, Fill all, an added row, Save and close the day with one Close short and one Move the rest; the Overview today units equal what was saved. |
| `month-close` | Closes ECOMM's first month (every earlier month is closed, so the checklist passes), sees the lock, then reopens it with a reason. |
| `kind-isolation` | Projects lists no programs, Programs lists all four, the FRA project build says Not billed. |
| `pulse` | J-1040 shows the Program card, By variant and the GLOVE month money. |
| `crm` | The Gripwell account Programs tab shows GLOVE with the same money. |
| `money-hidden-aisha`, `money-hidden-liam` | No money on Overview or Activity; CSV and PDF statements return 403. |
| `floor-today` | One row per program inline, then Close the day for all. |

Each run makes its own program (key `E` and four letters), so it can run twice in a row. Floor
today logs output on every program, so it runs last; reseed before taking the 9.4 screenshots
again. The script exits with 1 when any flow fails and saves a screenshot of the failed screen.
