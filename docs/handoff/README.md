# Handoff: continue the KitStaks WMS audit rounds on another machine

This picks up where the first machine paused on 2026-11-09. Paste the **Prompt for the new session**
(below) into a fresh Claude Code session opened in a clone of this repo.

## Where things stand

- All 14 modules (M01–M14) have a first build. The code is on `main` in KitStak/KitStakWMS.
- An audit run was in progress: a spec-based critic reviews each module, then a builder fixes
  every finding, repeating up to 5 rounds. It was paused during round 1.
- Round-1 reviews finished for **M01–M06** (none passed). They are saved in `audit-r1/`:

  | Module | Scores (hierarchy/density/color/craft/states/sideBySide/functionality/completeness) | Failures | Logiwa gaps | Fixes listed |
  |---|---|---|---|---|
  | M01 orders-outbound | 7/7/6/6/4/5/3/6 | 17 | 10 | 21 |
  | M02 shipping | 8/6/6/7/7/7/6/7 | 8 | 6 | 17 |
  | M03 fulfillment-jobs | 7/6/5/6/7/7/7/7 | 12 | 8 | 21 |
  | M04 stations-returns | 7/7/6/6/6/7/7/7 | 13 | 5 | 22 |
  | M05 inbound-receiving | 7/7/7/6/5/6/5/7 | 14 | 8 | 23 |
  | M06 inventory | 8/7/7/7/6/8/7/8 | 8 | 6 | 18 |

- M07–M14 have not been reviewed yet. No fix agent had started, so no code was half-edited.

## Files in this folder

- `critic-rounds.js` — the audit workflow script. It embeds the M01–M06 round-1 reviews, so those
  modules go straight to fixing in round 1. M07–M14 start with a review.
- `audit-r1/M0x.json` — the six round-1 reviews (scores, failures, Logiwa gaps, concrete fixes).
- `research-modules.json` — per-module scope (owned paths, routes, checklist, acceptance) that the
  script and agents read.

## One-time setup on the new machine

```bash
git clone https://github.com/KitStak/KitStakWMS.git
cd KitStakWMS
npm install
```

Create `.env.local` (it is not in git). At minimum:

```
SESSION_SECRET=<64 hex chars: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
CRON_SECRET=<another random value>
```

Build the local database (`.data/kitstak.db` is not in git) and confirm it is consistent:

```bash
npm run db:reset
npm run db:verify
```

Start the dev server through Claude's preview (`.claude/launch.json` → `kitstak-dev`, port 3000).
Local demo login: `admin@kitstak.io` with the demo password from the seed (localhost only).

## Prompt for the new session

> Continue the KitStaks WMS audit from docs/handoff/README.md. Ultracode.
>
> Task: run the audit workflow in `docs/handoff/critic-rounds.js` (copy it to `.data/critic-rounds.js`
> and run it with Workflow `scriptPath`, since scripts must live in the working directory and `.data/`
> is gitignored). Do the one-time setup first if `.data/kitstak.db` or `.env.local` is missing, and
> start the dev server with preview_start "kitstak-dev".
>
> How: each module loops critic → builder fix, up to 5 rounds, max 5 agents at once, with a shared
> typecheck queue (`node scripts/tc-queue.mjs <paths>`). M01–M06 start with their saved round-1 reviews.
> The live Logiwa sandbox is not used; critics compare against `references/logiwa-spec/*.md`.
> Agents never run db:reset or next build, never commit, and close their own browser tabs.
>
> Goal: every module passes — every score ≥ 9, verdict "wowed", zero functional failures and zero
> Logiwa gaps — then the final gate is green: lint, typecheck, `npm test`, `npm run db:verify`,
> `next build`, and no route still renders a placeholder.
>
> Stop point: pause when either (a) the gate finishes, or (b) I say pause. To pause cleanly, wait
> until no `-fix-`/`-wire-`/`fpatch` agent is running (critic-only moments are safe), then stop the
> workflow, so no file is left half-edited. Report per-module verdicts, scores and remaining
> failures. Commit and push to KitStak/KitStakWMS only when I ask.

## Known open issues (from before the pause)

- A disposed return leaves a restored serial pointing at an empty bucket; the fix needs a new
  "removed" serial status (schema change).
- PO receiving still allows serial-tracked products to be received without serials.
- Error red (#B42318) is close to brand crimson; chart palette and "In progress" blue not rebranded.
- Status pills use light-only colors and look wrong in dark mode (M02 review, fix listed).
- Dark mode has only been checked on the dashboard and orders screens.
- facility-config REQ-2 (nullable walking_path/column) was rejected: the SQLite table rebuild is unsafe.

## Don't run both machines at once

Both machines would edit the same files. Keep the first machine's audit paused while the second
runs it, or split modules by branch and merge afterwards.
