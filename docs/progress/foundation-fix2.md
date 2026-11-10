# Foundation fix2 (critic round 2): progress

## Code changes
- [x] 1 globals.css: border-color default moved into `@layer base` (`*, ::before, ::after`)
- [x] 2 use-url-state: grid/url state uses `history.replaceState` and keeps the hash; `{ serverParams: true }` falls back to router.replace
- [x] 3 search: jobs, pos, locations and lps providers are live and use scopedWhere (owner "foundation"; M03, M05 and M10 may replace them)
- [x] 4 search UI: groups ranked by best hit rank, bold matches in titles and subtitles, singular type labels, a "See all N …" row, a 3-row skeleton, no spinner
- [x] 5 `html { scrollbar-gutter: stable }` plus a react-remove-scroll-bar margin override
- [x] 6 mega-menu: the underline uses only route activity and Radix data-state, so `value` can no longer leave it stale
- [x] 7 top-nav focus ring is ring-2 ring-inset white/80; menu-item ring raised to primary/60
- [x] 8 header: search pill shows "Search…" plus the / key; the context label is short ("MLT1 · All") and never truncated, with a tooltip for the long form
- [x] 9 printers: opens on the context warehouse; the list puts the context warehouse first, then sorts by code; the RadioCards chooser has no overlay covering the footer
- [x] 10 dashboard filter replaced by a read-only ContextChip whose "Change" opens the header switcher (event ks:open-context-switcher). This edits M13 legacy files; see Notes.
- [x] 11 seed: client code NOVA renamed to NVF (live DB updated in place); codeNameLabel matches the code as a whole token; export names use the browser zone, else the warehouse zone (resolveExportTimeZone), and the old UTC file name was re-stamped; the Day Shift card runs on the warehouse clock and shows "Shift ended 17:00" (src/lib/shift.ts)
- [x] 12 status pills: Ready-* in readyBlue, *-Started in indigo, Loading in teal; work order Completed and return Started are soft; priority uses one soft treatment (Urgent gets ChevronsUp)
- [x] 13 grid toolbar: one nowrap row with min-w-0 chips, a Save filter icon button, and a text-ellipsis placeholder
- [x] 14 dev/ui column widths tightened
- [x] 15 bulk actions: `eligibility(ids)` decides per selection; dev/ui Cancel is disabled for Shipped orders
- [x] 16 wizard: Enter runs Next or Save; focus moves to the first field of the new step; WizardSuccess says "updated" in free mode; dev/ui asks for confirmation before switching modes with typed data; one primary Save (in the rail when present)
- [x] 17 dev/ui: scroll-spy nav, scroll-mt-[72px], CSS-columns status maps, tooltip copy fixed
- [x] 18 unsaved guard: danger variant, AlertTriangle icon, Stay focused, Leave as the danger action
- [x] 19 root 404 copy and a Go back button; the record 404 sets the title "Not found · KitStak WMS"; orders/[id]/loading.tsx uses DetailPageSkeleton
- [x] 20 403 shows the denied path and a Go back button
- [x] 21 login: SSO tooltip ("SSO isn't configured for this workspace") made reachable; demo callout only when not production or DEMO_MODE=true; a wrong password returns 200 + success:false through the x-ks-soft-auth-failure header (no console 401)
- [x] 22 placeholder copy reads "This page is coming soon. Bookmarks to it will keep working."; the module is kept in data-module
- [x] 23 Tooltip opens only on hover or :focus-visible; disableHoverableContent
- [x] 24 user menu items render as `<a href>` (DropdownMenuItem `href`)
- [x] 25 shell renders the SSR context label (loadInitialShellContext), with no skeleton bar

## Verification (browser, own tab, 1440 and 1280)
- [x] invalid border rgb(180,35,24); focused border rgb(46,92,230); scrollbar-gutter stable; no header shift when popovers or the Actions menu open
- [x] grid search writes ?q= and keeps #grid with no RSC request; the toolbar with a chip stays on one row; the grid has no horizontal scroll at 1440 (sw = cw = 1121); Cancel is disabled for SO010838 with the tooltip "Shipped orders can't be cancelled"
- [x] search: Job005259 finds the job; "apex" ranks Clients first, bold matches, singular labels, See-all row, skeleton rows
- [x] context chip "Change" opens the switcher; printers open on MLT1 with MLT1 listed first; user menu items are `<a href>`; no stale underline on /settings/apps
- [x] 404 root copy and Go back; the record 404 title is "Not found · KitStak WMS" after a detail skeleton; 403 shows the path and Go back
- [x] login: wrong password shows an inline error with no console error; the SSO tooltip appears; demo callout shows in dev
- [x] wizard: Enter advances, focus lands on step 2's first field, one Save, the mode switch confirms, free mode says "updated"; scroll-spy and #overlays anchor work
- [x] header at 1280 does not overflow (sw = cw); context "MLT1 · All" is not truncated; at 1400+ the pill is 176px

## Notes
- The headless browser pane pauses rendering while hidden, so hash scroll, transitions and Suspense reveal finish only after a paint. HashScroll now starts its settle window on the first frame.

- Owner exception: src/components/dashboard/{filter-bar,widgets}.tsx and src/app/(app)/dashboard/page.tsx (M13 legacy, untouched since the initial commit) were edited minimally for items 10 and 11.
