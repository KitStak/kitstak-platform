# Foundation F4a — client lib + UI primitives — COMPLETE

Owned: `src/lib/**` (except `grid-defs/**`; `domain-types.ts`/`enums.ts` are F1's and untouched),
`src/components/ui/**`. Tests: `tests/unit/foundation-f4a/**` (72 tests).

## F4.1 src/lib
- [x] api-client.ts — `apiFetch`/`apiRequest`, `ApiError{code,message,status,fieldErrors,requestId}`, CSRF (cookie → GET /api/auth/csrf → retry once on 403 CSRF), 401 → `/login?next=`, code `NETWORK` for offline
- [x] query-client.tsx — `QueryProvider`, `useApiQuery(key, path, {query})` → `{data, meta}`, `useApiMutation({path, method, body, invalidate, successMessage, errorTitle, form})`, `applyServerFieldErrors`
- [x] use-url-state.ts — `useUrlState(defs)` + `urlParam.*`, `useGridUrlState(gridKey)` (grid grammar via `@/server/query/grid-query`), 250 ms debounced `router.replace`
- [x] format.ts — token formatter (default `M/D/YYYY h:mm:ss A`, picker `YYYY/MM/DD HH:mm`), money grid/summary, quantity, measure/weight, age; `FormatProvider`/`useFormat`
- [x] countries.ts — ISO countries (250), 62 US states/territories, 13 CA provinces
- [x] status-colors.ts — every 0.5 map (`statusTone(status, domain)`)
- [x] integration-errors.ts — 14 codes with title/explanation/action/guide
- [x] channel-catalog.ts — 15 channels + 13 carriers, monogram SVG logos, availability
- [x] permissions-client.tsx — `useMe`, `useCan`, `<Can>`, `useRestriction`, `hasPermission`
- [x] keyboard.ts — registry, `useShortcut`, `useShortcutList`, `formatCombo`
- [x] scan.ts — `createScanDetector`, `useBarcodeScanner`
- [x] use-unsaved-changes.ts (extra) — `useBeforeUnload`, `useNavigationGuard`

## F4.2 src/components/ui
- [x] overlays: dialog, confirm-dialog, drawer (+unsaved guard), toast (store), toaster, unsaved-changes
- [x] menus: tooltip (+`DisabledReason`), popover, info-tip, dropdown-menu, dropdown (compat, unchanged)
- [x] tabs/toggles: tabs (Underline/Page/Segmented/VerticalNav), segmented-control, switch, checkbox (tri-state), yes-no-toggle, radio-cards
- [x] inputs: select, combobox (+combobox-data), calendar, date-picker, datetime-picker, time-picker, date-range-picker, number-input, text-field, textarea, chip-input, color-swatch-picker, file-dropzone
- [x] display: badge, status-pill (domain-aware; old exports kept + DifferencePill/YesNoPill), progress-ring, progress-bar, avatar, kbd, skeleton, stat-tile, kpi-chip, empty-state (+ActionCards), callout, barcode, spinner
- [x] form/* — useZodForm, Form (focus first error, guardUnsaved), FormField, FormSection, FormGrid, SubmitBar
- [x] wizard/* — Wizard (linear/free, page/drawer), useWizard, stepper, pills, rail, success, sessionStorage drafts

## Verification
- [x] `npx tsc --noEmit` — 0 errors (whole repo at time of check)
- [x] `npx eslint src/lib src/components/ui` — 0 errors (2 informational react-compiler "incompatible-library" warnings for react-virtual / RHF watch)
- [x] `npx vitest run tests/unit/foundation-f4a` — 72/72 pass, no React warnings
