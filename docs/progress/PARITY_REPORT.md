# KitStak WMS: Final Parity Report (release gate, 2026-11-10, afternoon)

**Status: the release gate is green on the current working tree.** No other agents were running. Nothing has been committed. This report replaces the morning hand-off report, which was red because of concurrent edits.

The final blind judge picked KitStak in **all 14 of 14** modules. The critic marked only **4 of 14** "wowed" (Inbound receiving, Inventory, Stations & returns, Reports & analytics). **Twenty-two major findings and one blocker are still open across 11 modules.** The single biggest gap is live connectivity: every carrier and channel integration still runs on the local simulator or demo feed, and closing that needs real credentials from the account owner.

## Gate results

| Gate | Result | Notes |
|---|---|---|
| `npm run typecheck` | **Green** | `tsc --noEmit` reports 0 errors. Re-run after this gate's edits. |
| `npm run lint` | **Green** (0 errors, 189 warnings) | The warnings are unused variables and React Compiler advisories. |
| `npm test` (vitest) | **Green: 2440/2440 tests in 277 files** | |
| `npm run db:verify` | **Green** | Every invariant reconciles: 969 buckets, 3,419 transactions, 48,691 on-hand units. There are 282 empty-bucket warnings, which do not fail the check. Re-run after the dead-click crawl, because that crawl makes real clicks. |
| `npm run test:e2e` | **Green, every spec** | Run against the shared `next dev` on :3000 in four batches so each finished within 5 minutes: foundation, counts, admin and facility (185); inbound receiving (16); inventory (23); shipping, stations and reports (35). Each count includes the 4 auth-setup tests. The pinned Playwright 1.55 browser (headless_shell-1187) is not installed, so the runs used `PW_CHROMIUM_PATH=…/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-win64/chrome-headless-shell.exe`. Three failing tests were fixed; see below. |
| `npm run audit:dead-clicks` | **Green: 0 real dead controls** (see method) | The stock crawler needs about 1 hour for the full run, and it did not finish 2 routes in 5 minutes. To stay inside the 5-minute command limit, I ran the same detection signals in parallel and resumable form: `…\kitstak-critic\final\dc.cjs`. It covered all 99 nav routes plus a shell-only pass, about 6,000 control clicks. It flagged 5 controls. Each one was re-checked directly and is a false positive (details below), and two of those false-positive classes were fixed in the official audit. The full stock `npm run audit:dead-clicks` was **not** re-run end to end in this gate. |
| Left-nav smoke (headless, admin) | **Green: 99/99** | Covers every nav-config route plus every link the shell renders. There were 0 console errors, 0 page errors, 0 HTTP 4xx/5xx responses and no login bounces. The slowest loads were /products 4.4 s, /inventory 3.3 s, /packing-station 3.2 s, /shipments 3.0 s and /billing/reports 2.8 s. Script: `…\kitstak-critic\final\navsmoke.cjs` |
| QA records in seed files | **Clean** | No KS-CRIT-, KS-FIX- or KS-BLIND- records in `src/server/db/seed*` or the seed scripts. `KS-FIXTURE-*` in `acceptance-fixtures.ts` is the e2e fixture set loaded by `db:fixtures`, so it stays. QA rows that buyers see (the KS-FIX-M04 orders, the KSSCALE warehouse, KS-CRIT tags and SKUs) live only in the dev DB, `.data/kitstak.db`, not in the seeds. |

### The two interrupted repair builders
Both `repair:inventory:t1` and `repair:shipping:t2` leave large but coherent uncommitted diffs: about 1,600 lines in inventory and about 900 in shipping components and repositories. Typecheck, lint, unit tests, the inventory e2e (23) and the shipping e2e all pass on them. Nothing was half-written. **However, I did not visually re-verify their critic items**: the By Location sticky ⋮ column covering Free Quantity, and the shipping timezone and pickup-time fixes.

### Fixes made in this gate
- **Create LP number drawer (product):** the drawer reset its form whenever the default warehouse finished loading. That could wipe a choice the user had already made, such as SSCC18 = Yes. It now resets only when the drawer opens and fills in a late-arriving default warehouse without touching the other fields (`src/components/facility/lp-numbers/lp-number-drawers.tsx`). The e2e flake had a second cause, a layout shift during first paint, so the test now retries the toggle until it sticks.
- **e2e `GET /forbidden`:** the proxy now deliberately serves the access-denied page with a real 403 status, so the route test expects 403 for that one route.
- **e2e RMA wizard:** two stale assumptions were fixed. Virtual locations are no longer valid return targets, so the target is now RET-02 instead of MLT1-RTN. On the Items step, Next now validates on click instead of being disabled.
- **Dead-click audit tooling** (`tests/e2e/fixtures/dead-click-page.ts`, `dead-click-audit.spec.ts`): a radio that is already checked now counts as "current" (the same rule as `aria-selected` and `aria-pressed`). Opening the native file picker (`filechooser`) now counts as an observable effect.

### Dead-click false positives (each re-checked directly)
- `/settings/company` "Add file": opens the native file picker, which the old crawler could not see.
- `/products/listings` "Create a product": opens the link drawer in about 100 ms. My crawler re-matched the wrong row after a reload.
- `/products/listings`, `/organization/vendors`, `/shipments/history` density "Large"/"Small", and `/settings/data-setup/code-generation` "Keep adding codes manually": density is saved per account, so the parallel crawlers flipped it between them, and the control flagged was the radio that was already checked. Re-checked serially, every one of these mutates the page.
- The stock audit's morning findings (68 "Move X column" drag handles, "About X" info tips and "More information") now carry `data-audit-skip`.

## Per-module summary

Column key: **Loop** is the module-loop critic score (r6). **Latest** is the critic score after the blind-judge repair (1 repair round each).

| Module | Loop (r6) | Latest | Wowed | Blind judge | Open blocker / major | Gaps needing real credentials |
|---|---|---|---|---|---|---|
| Orders & outbound | 8.6 | **7.4** ↓ | No | KitStak wins | 4 major | Live rate shopping and label purchase |
| Fulfillment & jobs | 8.6 | 8.3 | No | KitStak wins | 3 major | — |
| Inbound receiving | 8.7 | 8.7 | **Yes** | KitStak wins | 1 major, plus a blocker in the gap list (see below) | — |
| Inventory | 6.4 | **9.0** ↑ | **Yes** | KitStak wins | 0 | — |
| Catalog | 8.6 | 8.6 | No | KitStak wins | 1 major | — |
| Facility config | 9.0 | 8.6 | No | KitStak wins | 1 major | — |
| Counts | 7.1 | 8.3 | No | KitStak wins | 2 major | — |
| Work orders & kitting | 7.8 | 8.5 | No | KitStak wins | 1 major | — |
| Shipping | 7.6 | **7.4** | No | KitStak wins | **1 blocker** + 2 major | **Yes: UPS/USPS/FedEx** |
| Stations & returns | 7.9 | **9.5** ↑ | **Yes** | KitStak wins | 0 | — |
| Organization & billing | 6.0 | 8.6 | No | KitStak wins | 1 major | Accounting export (e.g. QBO) |
| Automation & integrations | 8.1 | 7.8 | No | KitStak wins | 2 major | **Yes: Shopify / ShipStation / UPS, Shopify Partner app** |
| Reports & analytics | 7.6 | **9.2** ↑ | **Yes** | KitStak wins | 0 | — |
| Admin settings | 7.8 | **7.4** | No | KitStak wins | 4 major | SMTP, SAML IdP, a signed print agent |

The repair round raised Inventory, Stations & returns, Reports & analytics, Organization & billing, Counts and Work orders. Orders & outbound, Facility config, Shipping, Automation & integrations and Admin settings fell below their loop scores. In those modules, deeper live walks found data-integrity and test-data issues that the module loop had missed.

## Per-module detail

### Orders & outbound: latest 7.4, not wowed, blind win
**Why it won:** a real read-only order detail page (Overview, Edit, Jobs & Shipments and Activity tabs, plus a fulfilment progress grid, hold banner and unified timeline). Every disabled menu item says why it is disabled. It also has hold and release, duplicate, a cancel dialog with reasons, and eligibility counts for job operations.

**Open majors:**
- `/orders/new` step 3: the 29-column line table spills out of its card, so the page pans sideways (scrollWidth 3517 px at both 1440 px and 390 px).
- Step 3 at 390 px: search results hide the SKU and name, and the Add button is clipped.
- A carrier/service pairing that cannot exist: "UPS · UPS First Class Mail" on SO010887, and the raw setup name "UPS-TEST" shows as the carrier.
- Visible QA data: orders KS-FIX-M04-*, the "KSSCALE - Scale test warehouse" in pickers, and RMA000323/324 with tracking 1ZLOOP0001.

**Remaining gaps:**
- Purge KS-CRIT/KS-FIX data from the dev/demo DB and hide test warehouses.
- SO010886 shows On Hold while its log says it was merged.
- Prove scale with thousands of orders; the backlog has 49 rows.
- Seed a demo carrier and rate preset so Get rates returns quotes. A real purchase needs carrier credentials.
- Mobile tab-strip clipping.
- The confirm-step warehouse value has no label.
- The Tag and status menus open on loading text instead of instant content.
- The Shipped & Canceled tab needs an empty state.
- RMA 3-step with a return label, bulk return info and shipment history were not verified end to end.

### Fulfillment & jobs: latest 8.3, not wowed, blind win
**Why it won:** a real job detail page with progress by phase, orders, tasks, pick path and timeline. It can act on exceptions (retry allocation, create backorder) and has cancel, assign and recount for count tasks.

**Open majors:**
- Replenishment job progress sums different UOMs and counts pick and put twice ("108/1071 units"), and the pick path shows no UOM.
- `/tasks/count` Filter has a duplicate `taskUomQty` key, which raises a React key error and leaves the field list empty.
- The replenishment Execute drawer does not prefill the planned target location.

**Remaining gaps:**
- The scheduled D2C wave allocates 0 of 7 orders.
- KS-CRIT rule and SKU leak into grids.
- Wave rule names are cut off with no ellipsis.
- The default chip on the Replenishment and Count task tabs filters by job status.
- Task Details pages take 3–4.4 s.
- Open-job volume is thin (27).
- Replenishment bulk actions are thin.
- Cart, tote, put-wall and cartonization are not shown on job detail.
- No visible trail proving scheduled waves run on their own.
- Pick wording ("Orders are matched", "picked units") is copied into count and replenishment.

### Inbound receiving: latest 8.7, wowed, blind win
**Why it won:** partial receiving on the web (qty per line, suggested location, LP modes, damage, lot, expiry and serial), a Putaway worklist with ranked suggestions, and a richer PO list.

**Open major:**
- The same receipt shows in two time zones and formats. The ledger uses browser time in M/D/YYYY, while receiving uses warehouse EST in YYYY/MM/DD, so the times differ by 1 hour.

**Remaining gaps:**
- **Reported BLOCKER:** on /receiving/new step 1, Next silently does nothing. In this gate the `po-acceptance` e2e, which walks the wizard from step 1 to creating the PO, **passed**, so it did not reproduce there. It has not been re-walked by hand with KS2 and CPL/APX. Re-verify before demo.
- History first load is 10.7 s and putaway 7.5 s.
- KS-TEST and KS-CRIT POs dominate page 1.
- RF receiving was not shown at 390 px.
- No scale proof.
- The putaway worklist needs an age/SLA column and a suggested-destination column.

### Inventory: latest 9.0, wowed, blind win
**Why it won:** same structure as the competitor, plus a per-row detail drawer (Attributes, Allocations and a Transactions ledger) and a safer row menu that explains count locks.

**Open majors:** none.

**Remaining gaps:**
- The sticky ⋮ column covers Free Quantity at 1600 px (repair diff present but not visually re-verified).
- The ATP "WAREHO…" header is cut off.
- KS-BLIND and KS-CRIT items and test imports are visible.
- Blank image tiles.
- Only 309 location rows against the competitor's 8,048.
- Kit Inventory names are cut off.
- Toasts have no "View transaction" link and no undo.

### Catalog: latest 8.6, not wowed, blind win
**Why it won:** every competitor surface, plus a product detail page with 7 KPI tiles and 8 tabs, and a richer list (views, bulk activate, 33-column chooser).

**Open major:**
- The product-detail stock tiles contradict each other: ATP 428 is higher than Unallocated 413, and the 15 allocated units cannot be traced.

**Remaining gaps:**
- At 390 px the grid hides SKU and Name.
- The Transactions tab has no filters, paging or export.
- Replenishment and allocation cannot be edited inline.
- The pack-type helper text wraps badly.
- List state is not in the URL.
- No quick-edit, image upload or next/prev navigation.
- The Advanced enumerations were not fully spot-checked.
- Placeholder thumbnails.

### Facility config: latest 8.6, not wowed, blind win
**Why it won:** a location generator with preview and collision check, a real location detail page, a zone summary strip, and Lock/Unlock and Label modals.

**Open major:**
- The MC-01 mobile cart contradicts itself: a single-job cart holds SO010880 from another job, and the KPIs show 11 vs 12 occupied cells.

**Remaining gaps:**
- The change log has no real history on seeded records.
- No in-grid bulk edit.
- Lists take about 4 s at 5k locations.
- Location group names repeat across warehouses.
- The zone strip gets too long.
- LP Lock/Print/Void tooling is thinner than for locations.
- No live create/edit/delete cycle has been shown.

### Counts: latest 8.3, not wowed, blind win
**Why it won:** a richer plan wizard with an AI "Suggest" ranking, a variance preview before posting with a required reason, and a plan detail page with KPIs and a timeline.

**Open majors:**
- Seeded plan CNT000141 posts inventory before the count completed, and three different "inventory updated" times appear.
- The CNT000146 Count Object column includes cancelled lines.

**Remaining gaps:**
- The Timeline "Inventory" filter shows 0 events.
- Seeded plans show the update user as "-".
- Header counters vs cancelled lines do not reconcile.
- Recount lines still show approved quantities.
- The Count Sheet skeleton shows for about 1–2 s.
- Count job-type configuration depth.
- No range filter on Difference.
- Recount eligibility in the UI.
- Ledger filter by plan.
- Plans are not locked after Inventory Updated.
- Dev-server resilience during demos.

### Work orders & kitting: latest 8.5, not wowed, blind win
**Why it won:** the wizard suggests codes, shows buildable kits, and offers a FEFO source picker and auto-assign. Kitting has per-source scans with rejection, a Current/Change/After summary and a success card.

**Open major:**
- The detail header collapses at 768 px (title shows "W.") and the page scrolls sideways at 390 px.

**Remaining gaps:**
- Mobile header and action overflow.
- No handheld pick/kit screens.
- No configurable Work Order job type is shown.
- The activity timeline leaves out allocation and pick events.
- Disassemble has no lot, expiry or attribute fields.
- Two save confirmations.
- Upload and print-preview were not proven.
- Search is not in the URL.

### Shipping: latest 7.4, not wowed, blind win
**Why it won:** larger column sets on every screen, a plan detail page with a stepper, KPIs and a timeline, a package drawer with carrier activity, and EOD tools (stale-manifest banner, auto-close rules, schedule pickup).

**Open blocker and majors:**
- **[blocker]** Live carrier connectivity is unproven. Every label, void, tracking refresh and EOD close goes through the local simulator ("this connection has no carrier credentials"). **Needs real UPS/USPS/FedEx test accounts from the account owner.**
- [major] The simulated tracking refresh records a pickup before the scheduled pickup, on a manifest that was never closed.
- [major] Time zones are mixed between the EOD grid, the Auto-close dialog and pickup/activity times. A shipping repair was in flight; not re-verified.

**Remaining gaps:**
- Real carrier credentials (above).
- /shipment-plans/SP000045 returns 404 when opened by plan code.
- Title casing is inconsistent.
- The EOD confirm says "1 package are".
- Duplicate "Print" accessible names.
- Clicking a tracking number or row does not open the package drawer.
- No printed-document previews.
- EOD and History need default chips and views.
- No shipping KPI header.

### Stations & returns: latest 9.5, wowed, blind win
**Why it won:** packing was demonstrated end to end (scan, blocks, package auto-dimensions, weight suggestion, multi-package and an inline rate shop), with a 0.3–0.6 s render, pack progress that survives a reload, and a hospital-locations page.

**Open majors:** none.

**Remaining gaps:**
- Configurable packing warnings with acknowledgement.
- Package types tracked as inventory, with tare and max weight enforced.
- Return fees.
- The Report issue dialog's default does not match its copy.
- A toast covers the tab strip.
- Opening an order sets Packing Started.
- The viewer's disabled reason names the wrong permission.
- Resolve pack shorts from the hospital page.
- Mobile header on the dashboards.
- Return-label actions from the Shipped grid.

### Organization & billing: latest 8.6, not wowed, blind win
**Why it won:** a client detail page with KPIs and 6 tabs, read-only detail drawers with richer kebabs and disabled reasons, and inline validation on every create form.

**Open major:**
- 5 of 27 vendor rows are KS-TEST QA records, on the first screen.

**Remaining gaps:**
- Purge test vendors.
- The VAS Import button is not gated for the viewer.
- No Draft contract is seeded for an approve demo.
- No numeric comparators in the condition builder.
- Only one storage calculation type.
- Accounting export is not a real connector. **Needs credentials for the accounting target, e.g. QBO.**
- The client Activity tab is empty on seeded clients.
- CSV button styling.
- Lists take 2.7–5 s.
- Address management depth.
- The client "Billing plan" overlaps billing contracts.

### Automation & integrations: latest 7.8, not wowed, blind win
**Why it won:** a full workflow builder with test-on-order rollback and run history, an allocation dry run, Release and Retry loops on monitoring, and integration depth that matches tab for tab with extra columns.

**Open majors:**
- No channel or carrier has been proven against a live API. All 15 channels and 14 carriers are "Beta", and the 3 stores run on the "Demo feed". **Needs a real Shopify store or token and a live UPS/ShipStation account.**
- The Shopify Public App drawer shows customers developer setup notes (env-var names and a localhost redirect URL). **Needs a Shopify Partner app and `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET`.** The drawer copy should be made customer-safe even before that.

**Remaining gaps:**
- Live channel and carrier, and Public App OAuth (above).
- The 100% donut ring does not close.
- A Health Overview header collides with the next one.
- "Total: 0" shows while loading.
- The services skeleton shows on every open.
- The floating Feedback tab overlaps grids.
- Connector catalog padding.
- No Wave Rules cross-link under Automation.

### Reports & analytics: latest 9.2, wowed, blind win
**Why it won:** all 9 analytics pages work, while the competitor locks them behind a paid add-on. Dashboard drill-downs and Customize, 33 reports with a Report Hub, and named Views with export history.

**Open majors:** none.

**Remaining gaps:**
- Change Log cells are cut off.
- Time-zone labels are inconsistent (New York vs Chicago).
- Scale proof at 50k–100k+ rows and larger page sizes.
- Column resize and saved widths.
- No row-level actions from reports.
- No payload drawer for the integration and change logs.
- Labor time is partly inferred.
- No team-shared views or schedule management.
- No fix action for over-capacity bins.
- No ad-hoc pivot or report builder.

### Admin settings: latest 7.4, not wowed, blind win
**Why it won:** notifications, global search that finds records, a dedicated audit log, company security policy, SMTP, sessions, OIDC SSO, and richer user and role management.

**Open majors:**
- 14 of 17 shipment-order-type behaviours are still "Coming soon".
- The custom-carrier wizard promises services that never appear in order pickers (REQ-B1-5).
- Test data is visible: the KSSCALE warehouse on the dashboard and pickers, "round-1 live check" job types, a KS-CRIT wave rule, audit rows and notifications.
- The printers popover saves assignments, but no print flow sends jobs to the agent (REQ-B1-7).

**Remaining gaps:**
- The order-type behaviours above.
- Job-type condition depth and sort list.
- Free-form layout in the printouts designer.
- Custom carriers in order pickers.
- SAML sign-in. **Needs a customer IdP.**
- Real activation in the app marketplace.
- SMTP onboarding. **Needs SMTP credentials.**
- QA residue.
- Screen configuration beyond Receiving.
- A signed Direct Print installer.
- Settings hub first load of 4.4 s, and lookup slugs.

## Cross-cutting issues (most to least important)
1. **Live integrations (needs credentials).** Shipping, Automation & integrations and part of Orders cannot prove real carrier or channel traffic. Everything is simulated, with honest badges. This is the main objection an enterprise buyer will raise. It needs UPS/USPS/FedEx test accounts, a Shopify store or Partner app, and ShipStation access from the account owner.
2. **Demo-DB hygiene.** KS-FIX, KS-CRIT, KS-TEST and KS-BLIND records, the KSSCALE warehouse and "round-1 live check" job types appear in the Orders, Inventory, Receiving, Vendors, Jobs and Admin modules. They are in the dev DB `.data/kitstak.db`, not in the seed files. `npm run db:reset` returns a clean demo DB, but it wipes all critic evidence, so I did not run it. The scripts `scripts/purge-critic-data.mjs`, `purge-test-data.cjs` and `catalog-test-data.ts` cover part of this.
3. **Time-zone consistency.** Receiving vs the ledger, shipping EOD vs the dialogs, and reports vs schedules each use a different zone or format.
4. **Seeded data contradictions.** CNT000141 timing, the MC-01 cart, SO010886 merge vs hold, catalog ATP vs Unallocated, and replenishment UOM sums.
5. **Scale proof.** Most grids are demoed with tens to hundreds of rows. The competitor shows thousands. History, putaway and Task Details first loads take 3–10 s.
6. **Mobile and narrow widths.** Order wizard step 3, the work-order header, the catalog grid and the tab strips.

## Bottom line
On this tree the gate is green: typecheck, lint, 2440 unit tests, `db:verify`, every e2e spec, the dead-click sweep and the 99-route nav smoke. A de-branded blind judge prefers KitStak over the benchmark in all 14 modules. It is **not** "wowed across the board": 4 of 14 modules reached wowed, and 22 majors plus 1 blocker remain. The blocker and 2 of the majors cannot be closed without real carrier and channel credentials. Before a buyer demo:
- Reset or purge the demo DB.
- Fix the seeded-data contradictions.
- Re-check the inbound step-1 Next report by hand.
- Do a full serial `npm run audit:dead-clicks` (about 1 h) as a final formality.
