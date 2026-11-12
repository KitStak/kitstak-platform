# Foundation fix5 — critic round 5 (complete)

- [x] 1. Account pages are real screens: /account/profile (read-only profile), /account/password
      (current/new/confirm + password-checks checklist, POST /api/auth/change-password, server
      fieldErrors inline), /account/preferences (date/time/number formats + live preview, PATCH /api/me,
      invalidates ['me']). Files: src/components/layout/account/*, src/server/account/account-data.ts.
      Help "Open Preferences" link kept: it now opens the working screen.
- [x] 2. ModulePlaceholder: title "Module in progress", "Ships in Mxx" chip, data-placeholder attr.
      Copy lives in src/components/layout/module-placeholder-copy.ts. e2e acceptance constant updated.
- [x] 3. /dev/ui grid: accessorKey on code/status/channel/priority/totalQuantity/salesPrice/orderDate;
      header shows ArrowUpDown affordance on hover/focus for every sortable column (data-sort-affordance).
      orders-columns.tsx already had accessorKey on every column.
- [x] 4. Grid Cancel bulk action -> ConfirmDialog (red header, order+status mini-table, No/Yes) -> toast.success("Cancelled", "N orders cancelled (demo)").
- [x] 5. Overlays "Cancel 2 orders" -> toast.success("Orders cancelled", "SO010421, SO010422 cancelled (demo).").
- [x] 6. Order right rail ASSIGNED JOBS: job code (LinkCell, href /jobs/<uuid>) + real job type; getOrderDetail joins jobs (header.job).
      Dead remove (X) button now disabled with a reason tooltip.
- [x] 7. Expanded row: OrderLinesTable (32px rows, 12px, SKU/Description/Qty/Allocated/Picked); td is px-4 py-2.
      Lines come from loadDevOrderLines (src/server/dev/dev-orders.ts).
- [x] 8. DatePicker: opens on field click / Enter (focus stays in the field for typing); Today + Clear footer (28px, 12px).
- [x] 9. Copy: "Search and select", "Unit of measure", "Preferred carrier" placeholder "e.g. UPS Ground".
- [x] 10. Search hits carry `status {label, domain}`; palette renders StatusPill sm before subtitle (orders, POs, jobs).
- [x] 11. Showcase nav: 2px indigo rail + indigo text on aria-current=location; hover = bg only.
- [x] 12. /dev/ui grid section hugs content (min-h removed).
- [x] 13. Route progress: capture-phase listener on <html> (next/link preventDefault hid bubble clicks), bar at top:56px (top-full of header) in var(--primary); html[data-route-pending] dims #main-content to .6 after 400ms; unsaved-guard proceed calls startRouteProgress.
- [x] 14. Login demo card: NODE_ENV !== production AND DEMO_MODE in {1,true,yes,on} (src/app/login/demo-credentials.ts).
      .env.example documents DEMO_MODE; .env.local has DEMO_MODE=1 for local dev.
- [x] Verification: tsc clean, eslint clean on touched paths, vitest tests/unit (558 pass; seed.test hook + ops timeouts were load-related, ops and worker-start files re-run serially and pass), browser checks done.
