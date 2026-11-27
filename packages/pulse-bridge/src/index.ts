/**
 * @kitstak/pulse-bridge: how Portal, CRM, WMS and Projects read KitStak Pulse through the
 * shared database.
 *
 *   Reads    getOrgSummary · getJobsForRecord · getJobSummaries · getClientProfit ·
 *            listJobsNeedingAttention · getAttentionCount · getSetupSignals
 *   Access   resolvePulseAccess (the one rule for "who is this person in Pulse")
 *   Events   emitBridgeEvent (a record changed, Pulse should refresh it)
 *   Links    pulseUrls(base) (deep link builders, also at `@kitstak/pulse-bridge/urls`)
 *
 * Every call takes the host app's Drizzle executor. Reads never throw: they answer
 * `{ available: false, reason }` when the pulse schema is missing or the person has no Pulse
 * role, and they hide money on the server for people who may not see it. Checking that the
 * organization is licensed for the `pulse` module is the caller's job (see each app).
 */
export { pulseAvailability, resetAvailabilityCache, rowsOf, type BridgeExecutor, type PulseAvailability } from './executor';
export { resolvePulseAccess, resolveAccess, pulseRoleFromWmsUser, pulseRoleFromOrgRole, parseOrgRole, isPulseRole, type AccessInputs, type OrgRole } from './access';
export { getOrgSummary, getJobsForRecord, getJobSummaries, getClientProfit, listJobsNeedingAttention, getAttentionCount, getSetupSignals, lastDays, thisMonth } from './read';
export { emitBridgeEvent } from './events';
export { pulseUrls, type PulseUrls, type NewJobFromDeal } from './urls';
export { formatCents, formatMarginBp, formatQuantity, statusTone, type PulseTone } from './format';
export * from './types';
