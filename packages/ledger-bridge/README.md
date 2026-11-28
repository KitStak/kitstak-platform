# @kitstak/ledger-bridge

How CRM, Pulse, Portal, Projects, WMS and Crew read KitStak Ledger through the shared database (docs/ledger/SPEC.md 9.1). Raw SQL over the host's
Drizzle executor; reads never throw and answer "not available" when the `ledger` schema is absent.

Phase 0 skeleton:

| Export | What |
|-|-|
| `ledgerAvailability(db)` | `to_regclass('ledger.invoices')` and `ledger.member_roles`, cached 60 s per executor; errors are not cached |
| `ledgerOpenFor(db, orgId, gate)` | may this org see Ledger UI: the schema is there and `gate(slug)` (pass `(slug) => previewAccess('ledger', slug)` from `@kitstak/entitlements`) answers `full` |
| `resolveLedgerAccess(db, { orgId, userId })` | the person's role, rights and `seesBalances` (SPEC 3.2): explicit `ledger.member_roles` row, else owner and admin from the org role, else `settings.default_member_role` |
| `resolveAccess`, `listLedgerAccess`, `canClaim` | the pure resolver, every member at once, and the claim step |
| `rightsFor`, `roleHas`, `usesSeat` (`./rights`) | the rights table of SPEC 3.3, shared with the app's `src/lib/permissions.ts` |
| `LEDGER_STATUS_LABELS`, roles and types (`./types`) | client safe constants |
| `ledgerUrls(base)` (`./urls`) | deep links |

Money reads (`getCustomerBalance`, `getMoneyTiles`, `getSetupSignals`, `emitLedgerEvent`, ...) land with their phases.
