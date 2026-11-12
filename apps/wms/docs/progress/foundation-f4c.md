# Foundation F4c — shell, navigation, app pages — COMPLETE

Owned: `src/components/layout/**`, `src/config/**`, root/app layouts + error/not-found/loading/forbidden,
`imports/[key]`, `notifications`, `dev/ui`, login + `(auth)` pages, placeholder pages for unbuilt nav routes,
`src/lib/local-grid-query.ts`. Tests: `tests/unit/foundation-f4c/**` (40 tests).

## Config (`src/config`)
- [x] `nav-config.ts` — F4.7 map, pure data with no imports, so Playwright can `require` it. Every Logiwa item has `{label, href, permission[], owner, icon?, badge?, aliases}`.
  - 7 menus, Logiwa column structure and counts, plus Report Hub and Settings overview footers.
  - Also holds `USER_MENU_ITEMS`, `HEADER_ITEMS` and `DASHBOARD_ITEM`.
- [x] `page-tabs.ts` — all 20 F4.6 groups, each tab permission-tagged; `tabGroupForPath`.
- [x] `route-registry.ts` — nav + tab-only + detail/create routes (owner, permission, parent), plus:
  - `resolveRoute`/`resolveNearestRoute`, which prefer static routes over dynamic ones
  - `breadcrumbsFor`: `Menu › parents › page`
  - `routeLabelFromParam`, which only echoes safe values
- [x] `nav-access.ts` — `visibleMenus`, `visibleTabs`, `isAllowed`, `activeMenuKey`, `isItemActive`. Pure and immutable.

## Shell (`src/components/layout`)
- [x] `app-shell.tsx` — `AppShell({user, permissions})`. Permissions are resolved on the server in `(app)/layout.tsx`, so menus render without a flash. It also provides the FormatProvider fed by `/api/me` preferences, a skip link and a sticky header.
- [x] `mega-menu.tsx` — 7 mega-menus built on Radix NavigationMenu:
  - opens on hover after 150 ms, on click, or from the keyboard
  - column icons and headings, BETA badge, active underline
  - panel clamped to the viewport
- [x] `mobile-nav.tsx` — accordion drawer below 1024 px. Measured with no horizontal overflow at 800, 1024, 1280, 1440 and 1536.
- [x] `global-search.tsx`
  - Opens with `/` or Ctrl+K.
  - Pages group: instant, permission-aware, bold match.
  - Records groups: `GET /api/search`, debounced.
  - Recent searches in localStorage; full keyboard navigation via cmdk.
- [x] `transactions-tray.tsx` — query key `['background-tasks']`.
  - Polls every 5 s while a task is active; listens for `ks:transactions-refresh`.
  - Shows progress, status pills and download links.
- [x] `printers-popover.tsx` — warehouse step, then barcode and laser printers; `PUT /api/printers`.
- [x] `notifications-bell.tsx` — unread badge from `meta.unread`, mark read, mark all read, deep links.
- [x] `help-menu.tsx` — shortcuts sheet (also on `?`), Documentation guides, What's new, Contact support.
- [x] `user-menu.tsx` — permission-filtered My Profile, Change Password, Preferences, Company Settings and Apps; Sign out; Sign out all sessions.
- [x] `context-switcher.tsx` — `PATCH /api/me {context}`, then invalidates `['me']` and all queries and calls `router.refresh()`.
- [x] `page-header.tsx` — breadcrumbs derived from nav-config (or explicit), `crumbLabel` override, centered helper, actions, `tabs="<group>" | PageTabItem[]`. Legacy `UnderlineTabs` and `Breadcrumbs` exports are kept.
- [x] `breadcrumbs.tsx`, `module-placeholder.tsx`, `status-screen.tsx`, `error-view.tsx`, `shell-skeleton.tsx`, `app-providers.tsx`, `auth-frame.tsx`
- [x] `components/layout/nav-config.ts` — kept as a compatibility re-export. Its `NAV_MENUS` is the full searchable tree (dashboard, 7 menus, account, header), so `src/server/search/pages.ts` works unchanged.

## Pages
- [x] Root `layout.tsx` mounts QueryProvider and Toaster. Also added: `global-error.tsx` (`retry` prop, Next 16 API) and `not-found.tsx`.
- [x] `(app)/layout.tsx`, `error.tsx`, `not-found.tsx`, `loading.tsx`, `forbidden/page.tsx` (`?from=` label)
- [x] `(app)/imports/[key]` — 404 for an unknown key, `requirePagePermission`, breadcrumbs, and a "Not configured yet" callout for stub handlers
- [x] `(app)/notifications` — paged, All/Unread filter, mark all read
- [x] `(app)/dev/ui` — showcases:
  - every primitive (display, inputs, overlays, tabs, forms)
  - the wizard in linear and free modes, page and drawer variants
  - a grid over up to 500 seeded orders, evaluated client-side with `src/lib/local-grid-query.ts`: search mode, filters, chips, saved views, column chooser, bulk and row actions, expandable rows, plus an async server ExportButton
  - Gated on `settings.screen_configuration.view`.
- [x] Login: the "Forgot password?" link now goes to `/forgot-password`. The SSO button is disabled with a reason tooltip, so it is no longer a dead control.
- [x] `(auth)/forgot-password`, `(auth)/reset-password` (reads the company password policy and shows a live checklist)
- [x] 112 placeholder pages, one for every registered route that had no page. Each renders `<ModulePlaceholder route>` with the correct breadcrumb, title, tab strip and permission guard. Owning modules replace the file.

## Verification
- [x] `npx tsc --noEmit` — 0 errors (whole repo)
- [x] eslint on every owned path and the tests — 0 problems
- [x] `npx vitest run tests/unit/foundation-f4c` — 40/40. Full unit suite: 496/497; the one failure is the known F0 `instrumentation.test.tsx` scheduler assertion.
- [x] curl as admin: all 132 registry routes return 200. 112 are placeholders. The legacy detail pages correctly 404 for a fake id.
- [x] Browser (own tab, 1440 px)
  - Every item in all 7 mega-menus was clicked: 103 clicks, 0 failures, 0 console errors.
  - Search, tray, printers, bell, help, user menu, context switcher and the mobile drawer all open and work.
  - `/dev/ui`: grid search, filters and sort via the URL; wizard mode switch.
  - `/imports/shipment-orders`, `/notifications` and `/forbidden` render.

## Notes for later stages
- **Module owners:** replace your placeholder `page.tsx` files. Each is a 6-line `<ModulePlaceholder route="…"/>` file.
  - Use `<PageHeader title tabs="<group>" actions helper />`; breadcrumbs then derive automatically.
  - Pass `crumbLabel` on detail pages.
- **Restart the dev server.** The legacy `?tab=` redirects in next.config only activate after a restart, now that the destination pages exist.
- **F6 owner:** `src/server/search/pages.ts` may switch its import to `@/config/nav-config`. To keep user-menu and header pages searchable, walk `[DASHBOARD_ITEM, ...NAV_MENUS, USER_MENU_ITEMS, HEADER_ITEMS]`. The compatibility file already does this.
- **Record search** returns nothing until modules replace the stub search providers (`configured: false`). The UI already renders record groups.
- **New routes:** register every new route in `src/config/route-registry.ts`, either as a nav item or in `EXTRA_ROUTES`. `tests/unit/foundation-f4c/nav-config.test.ts` asserts that every registered route has a page file.
