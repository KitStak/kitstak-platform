/**
 * @kitstak/ledger-bridge: how CRM, Pulse, Portal, Projects, WMS and Crew read KitStak Ledger
 * through the shared database (docs/ledger/SPEC.md section 9.1).
 *
 *   Availability  ledgerAvailability (is the ledger schema there, cached 60 s)
 *   Preview       ledgerOpenFor (the preview gate for sibling UI)
 *   Access        resolveLedgerAccess, resolveAccess, listLedgerAccess, canClaim, rightsFor
 *   Links         ledgerUrls(base)
 *
 * Phase 0 skeleton. Money reads (balances, tiles, setup signals, events) land with their phases.
 * Every call takes the host's Drizzle executor; reads never throw.
 */
export { ledgerAvailability, resetLedgerAvailability } from './availability';
export { ledgerOpenFor, type LedgerGate, type LedgerGateAnswer, type LedgerOpen } from './preview';
export {
  resolveLedgerAccess,
  resolveAccess,
  listLedgerAccess,
  canClaim,
  parseOrgRole,
  ledgerRoleFromOrgRole,
  NO_ACCESS,
  type AccessInputs,
  type OrgRole,
  type ResolvedMember,
} from './access';
export { rightsFor, roleHas, usesSeat, LEDGER_SEATS } from './rights';
export { ledgerUrls, type LedgerUrls, type InvoiceSource } from './urls';
export { rowsOf, type BridgeExecutor } from './executor';
export * from './types';
