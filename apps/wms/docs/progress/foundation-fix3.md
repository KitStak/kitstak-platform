# Foundation fix3 (critic round 3): progress

## Code changes
- [x] 1 Header fits at 1280 and 1366 (scrollWidth 1270/1280 and 1356/1366).
  - Below 1440px the search is a 32px icon button; the "/" hint moved to its tooltip.
  - The mega triggers use px-1.5 (px-2 from 1440px).
  - The context chip shows `compact` ("MLT1").
  - The Dashboard text link only appears from 1440px.
  - Root cause of the 1416px width: legacy module pages inject `header button:has(> kbd){width:280px!important}`. The trigger now wraps its content in one span, so that selector no longer matches.
- [x] 2 Order detail shows `order.code`. The presenter no longer binds the code to the slug, and `getOrderDetail(key)` resolves either the id or the code (/orders/so010840 works).
- [x] 3 The Warehouse field and the summary rail show `warehouseLabel` (codeNameLabel join). Priority shows its label (Urgent / High / Normal).
- [x] 4 Barcode: `withIntrinsicSize` copies the viewBox size to the svg's width/height (210x91 on /dev/ui).
- [x] 5 /orders uses the shared StatusPill (domain shipmentOrder) and PriorityPill (an alias of PriorityFlag). Deleted orders/order-status-pill.tsx and order-priority-pill.tsx; the detail rail uses the shipmentOrder domain.
- [x] 6 The login form has method=post and action=/api/auth/login, and submit stays disabled until hydrated (useSyncExternalStore).
- [x] 7 Login fields use explicit label htmlFor/id plus aria-label Email/Password. The demo card shows only when NODE_ENV !== production; DEMO_MODE was removed from code and .env.example.
- [x] 8 Grid columns:
  - DateCell uses `fmt.gridDateTime` (MM/DD/YYYY h:mm A, full value in the title).
  - MoneyCell is right-aligned, nowrap and tabular.
  - Showcase widths: Client 168, Channel 128, Sales Price 116, Order Date 156 (each a minSize). Customer is hidden by default so 1440 has no horizontal scroll.
- [x] 9 The grid scroller is capped at max-h calc(100dvh-8rem), so the sticky thead (inset hairline) stays visible on long grids.
- [x] 10 The invalid inputs specimen shows FieldError "Enter a valid email".
- [x] 11 The eyebrow reads "Status pills". The scroll-spy uses `pickMostVisibleSection` (largest visible height, 5% IO thresholds), and the link blurs after a mouse click.
- [x] 12 globals.css adds thin scrollbars everywhere: scrollbar-width thin, scrollbar-color border-strong, a 6px webkit thumb with 3px radius, and no arrow buttons.
- [x] 13 The root not-found renders inside AppShell for signed-in users and in a branded top-bar frame otherwise. The StatusScreen H1 is 24px bold. `loadShellProps()` is shared with the (app) layout.
- [x] 14 The proxy applies real statuses through src/server/http/status-gates.ts: 403 for /forbidden and 404 for a missing /orders/:id. These apply to document loads only; RSC fetches are untouched. The record 404 shows `Home > Shipment Orders > Not found` through NotFoundBreadcrumbs.
- [x] 15 Shortcuts sheet:
  - It lists 10 goto shortcuts (D O J R I P L C T S) and a Grids group.
  - Each What's new entry shows a date, a version and a tag.
- [x] 16 Export toast: the "Open Transactions" action button opens the tray.
  - The refresh event no longer auto-opens the tray; a new open event does (src/lib/transactions-events.ts).
  - Empty tray copy: "No background jobs today. Exports and imports appear here."
- [x] 17 Brand constants are in src/config/brand.ts ("KitStak" / "KitStak WMS"). Used by app-shell, the root layout metadata, the login page, help-menu support, the dev/ui subtitle, the print toast, the reset email subject and the xlsx creator.
- [x] 18 Mega-menu: the existing bg-black/20 scrim was verified (opacity 1 when open). Column headings are h3 at 12px semibold, sentence case, not uppercased.
- [x] F7 DropdownMenu is now non-modal by default, so a click on another trigger while a menu is open is no longer swallowed. Verified: with the user menu open, one click opened the context switcher.
- [x] F8 Async combobox: Escape after Enter closes the listbox (verified in the browser). The code path was already correct; the critic most likely saw the hidden-pane animation pause.
- [x] F10 Printers popover prefetches on trigger hover or focus, shows a selector-shaped skeleton, and after 6s shows "taking longer than usual" with Retry.

## Verification
- tsc --noEmit clean.
- eslint on the touched paths: 0 errors (2 pre-existing warnings in orders-page.tsx and use-wizard.ts).
- vitest: 59 files and 552 tests pass, including the new tests/unit/foundation-fix3/fix3-pure.test.ts.
- curl and browser status checks:
  - 404: /orders/999999999 and /no-such-route
  - 403: /forbidden
  - 200: /orders/so010840, /orders/new and /dashboard
- Browser: header widths at 1280, 1366 and 1440; scrim; pill colours on /orders matching the 0.5 map; order detail fields; barcode size; sticky header; no clipped cells; scroll-spy; shortcuts sheet; toast action; printers; login names.

## Notes
- Legacy module pages (orders, clients, jobs, receiving, settings, products, transaction history, order detail) still carry the `header button:has(> kbd)` style shim. It no longer matches anything and the module owners should delete it.
- The orders/detail and orders repository edits were made under a foundation owner exception (M01 not started; legacy files).
