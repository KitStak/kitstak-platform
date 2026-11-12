# Foundation fix7: critic round 7 (complete)

All 13 items had already landed in fix5 and fix6. This round re-verified them against the live dev server and fixed the gaps listed below.

Browser note: the built-in Browser pane hit its tab cap (other agents hold every tab), so `tabs_create` failed. I ran verification with a headless Playwright script instead, using its own browser context against http://localhost:3000. The script is a scratchpad file and is not committed.

- [x] 1. Placeholder: on /analytics/labor/associate, `data-placeholder-module="M13"`, the copy "Module in progress" and the chip "Ships in M13" all render.
- [x] 2. Sorting:
  - Every /dev/ui data column has `aria-sort="none"` and a `[data-sort-affordance]` caret, and the caret's opacity rises on hover.
  - Clicking Sales price sets `?sort=salesPrice` and `aria-sort="ascending"`.
- [x] 3. Grid Cancel opens ConfirmDialog "Cancel 1 order?" with an Order/Status mini-table and No/Yes buttons. Yes shows the success toast "Cancelled · 1 order cancelled (demo)". The Cancel action is correctly disabled for non-cancellable rows.
- [x] 4. Overlays "Cancel 2 orders": Yes shows the success toast "Orders cancelled · SO010421, SO010422 cancelled (demo)." The toast appears after the 600ms demo delay.
- [x] 5. Expanded row mini-table: SKU/Description/Qty/Allocated/Picked, 12px, 32px rows.
- [x] 6. DatePicker:
  - The calendar opens on field click and on Enter, and focus stays in the input.
  - Today sets 2026/11/06 and Clear empties the field.
- [x] 7. Sentence case:
  - Already in place and confirmed in source: "Search and select" (printers), "Unit of measure", "e.g. UPS Ground".
  - Fixed this round: create-job modal "Create job"; custom fields drawer "Create custom field" and "Is active"; field type "Text box"; import details drawer "Import details", "Master rows" and "Show errors"; import history "Import history", "Uploaded by", "Download original" and "Download error file"; /dev/ui "Is active", "Create job" and "Order backlog".
  - Updated tests/e2e/foundation/dev-ui.spec.ts to match the new copy ("Create job", "Preferred carrier").
  - Left as is on purpose: "Export As Excel" (Logiwa parity, asserted by e2e), "My Profile" and "Change Password" (page titles shared with route-registry breadcrumbs in src/config), status values, and module-owned column headers (counts, clients, dashboard).
- [x] 8. Global search Records: a StatusPill ("Ready to Pick" and others) comes before "Customer · Client".
- [x] 9. Showcase nav `aria-current=location`: text is rgb(46,92,230) and `::before` is 2px wide in --primary.
- [x] 10. Grid section hugs its content. With the full list, the scroller is capped at the viewport (772px) and the section ends 1px after its last child plus padding.
- [x] 11. Route progress: the bar is `loading` at 14ms, top 56px, 2px tall, in --primary. `data-route-pending` is set at 421ms and #main-content fades to 0.6.
- [x] 12. Login demo callout renders in dev with DEMO_MODE=1, which is already in .env.local and documented in .env.example. It is gated by `demoCredentialsEnabled`, which returns false when NODE_ENV is production.
- [x] 13. 768px: no overflow (scrollWidth 762 against clientWidth 768), the hamburger is visible and the drawer opens with every menu. 1280px: no overflow and no hamburger. The headless viewport was reset when the script ended.

Test maintenance:
- The orders module rewrote src/components/orders/detail and orders-page.
- So I removed the stale order-presenter and orderFilterFields assertions from tests/unit/foundation-fix3 and foundation-fix4, because those belong to the orders module now.
- vitest foundation-fix3..6: 67 tests pass.

Full `tsc --noEmit`: the only errors left are in `scripts/verify-data.ts`, an old script that is not referenced anywhere. It is already tracked as REQ-8 in docs/requests/inbound-receiving.md and is outside my owned paths.

## F-patch (M12 round 1 trigger) — 2026-11-06
- Applied: admin-settings REQ-1 (screen-configs export key + null provider stub), REQ-2 (6 M14 routes); facility-config REQ-1 (verified already in `fromZodError`); automation-integrations REQ-6 (page-tab `match`), REQ-7 (KitStaks error codes + legacy mapping + live data fix).
- Rejected: facility-config REQ-2 (nullable walking path/column). It conflicts with the BUILD_PLAN F1 schema and would need an unsafe SQLite table rebuild on the live DB.
- Fixed a stale foundation test: `nav-config.test.ts` expects 21 page-tab groups, and `work-orders` may have a single tab.
- Known, not caused here: `foundation-f6/exports.test.ts` has 3 stale failures (they assume `orders-backlog` / `products` still use stub providers; those modules have landed real ones). `db:verify` reports 2 `serial_stock` issues from live module activity.
- tc-queue src: 0 errors.
