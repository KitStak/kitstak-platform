# Foundation fix1 (critic round 1): progress

All 24 fixes are implemented and verified in the browser at 1440 and 1280. tsc is clean, lint has 0 errors, and the affected vitest suites are green.

- [x] 1 focus-visible rule moved into @layer base with :where(); border-radius removed (globals.css)
- [x] 2 tab strips: overflow-y-hidden plus an inset-shadow baseline, no -mb-px (ui/tabs.tsx)
- [x] 3 ColumnChooser pinned to the grid header row's right end when hideToolbar (data-grid.tsx)
- [x] 4 search pill and context summary show from xl:, at xl:w-44 and xl:max-w-[160px]
- [x] 5 context switcher uses the ghost style; the skeleton shows the warehouse icon
- [x] 6 transactions tray: onOpenAutoFocus focuses the panel itself
- [x] 7 codeNameLabel() in lib/utils, used by printers and the context switcher (dashboard filter-bar is M13: not edited)
- [x] 8 printers: Search And Select combobox of registered printers (station defaults plus assigned names); Save disabled with a reason; step 1 shows Cancel
- [x] 9 search providers for clients, orders and products are live (server/search/providers, match.ts); help copy updated
- [x] 10 page hits: cap 12, prefix matches first, then nav order
- [x] 11 login: zod validation on the client, inline errors, focus on the first error, "Password" placeholder
- [x] 12 404 back link derived from the URL; instant=false on (app)/layout and orders/[id]
- [x] 13 Inter preload:false; sign-out does cancelQueries then a full navigation (no 401 on /api/me)
- [x] 14 notifications: optimistic mark read with rollback; ks-scroll on the list
- [x] 15 grid footer page size uses the Radix Select
- [x] 16 showcase column sizes, pluralised toast, in-grid Export As Excel (dev-ui-orders export provider); the separate specimen is removed
- [x] 17 export: toast on 202, real total (runner pages until meta.total), file name stamped in the browser time zone
- [x] 18 wizard: SKU required message; completion based on validity; rail Save disabled with "Complete required fields"; free mode shows checks
- [x] 19 number input: native spin buttons hidden
- [x] 20 status pill: 6px half-filled dot instead of the "P" glyph; StatusPill used in the ConfirmDialog table
- [x] 21 mega-menu scrim; column min-width 220px, labels nowrap
- [x] 22 avatar: lavender brand tone, initials rendered by the server (no Radix fallback delay); avatar shown in the shell skeleton
- [x] 23 PageHeader helper sits left under the H1 (13px, secondary, mt-1); /dev/ui hash scroll
- [x] 24 shortcuts sheet: merged rows, G-then-D and G-then-O sequences, Esc row
- [x] Browser verification: login empty submit; header at 1440/1280 with no overflow; tab strip 38/38; grid chooser and widths; export 389 rows named in local time; tray focus; optimistic bell; printers list; wizard; 404 with no issue badge; shortcuts; sign-out with no 401
- Header follow-up: at 1280–1399 the search pill reads "Search…" and the context summary truncates at 124px; from 1400px the full label shows. The logo wordmark now appears only at 2xl, so everything fits.
- Wizard: only the first zod issue per field is shown (use-wizard applyIssues).

## Outside foundation ownership (not edited)
- src/components/dashboard/filter-bar.tsx (M13) hardcodes "MLT1 – Main Fulfillment" with an en dash; it should use codeNameLabel().
- The dashboard renders its subtitle locally; now that PageHeader puts the helper on the left, M13 can pass helper= instead.
- /account/{profile,password,preferences} are M14 placeholders. F8 allows them.
- /api/orders (M01) ignores ps>50; the export runner now pages until meta.total.
