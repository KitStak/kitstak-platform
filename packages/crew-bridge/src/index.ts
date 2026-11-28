/**
 * @kitstak/crew-bridge (docs/crew/SPEC.md section 8.1): the shared database bridge into KitStak
 * Crew for Pulse, Ledger, WMS, Projects and Portal. Raw SQL over the host's Drizzle executor.
 * Reads never throw and answer "not available" (empty, null or role none) when Crew is absent.
 *
 * Phase 0 ships availability, access and onboarding signals. The people, hours, clearances and
 * billing reads of 8.1 arrive with the phases that make their tables.
 */
export { crewAvailability, resetAvailabilityCache, AVAILABILITY_TTL_MS, type BridgeExecutor, type CrewAvailability } from './executor';
export {
  canSeePay,
  canSeePrivate,
  crewRoleAtLeast,
  crewRoleFromOrgRole,
  isCrewRole,
  isDefaultMemberRole,
  parseOrgRole,
  resolveCrewAccess,
  resolveRole,
  type RoleInputs,
} from './access';
export { getSetupSignals } from './signals';
export { crewUrls, type CrewUrls } from './urls';
export * from './types';
