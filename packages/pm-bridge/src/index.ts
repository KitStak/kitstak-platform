/**
 * @kitstak/pm-bridge — how CRM and WMS talk to KitStak Projects through the shared database.
 *
 *   Reads   listLinkedWork · countLinkedWork · listWritableProjects · listOrgPeople
 *   Writes  createTaskFromExternal · linkProjectToRecord · removeLink
 *   Events  emitRecordStatusChange (deal stage changed, order shipped…)
 *
 * Every call takes the host app's Drizzle executor. Reads return empty results and events are
 * no-ops when the pm schema is missing; writes throw `BridgeError` with a plain-language message.
 * Entitlement gating (module `projects`) is the caller's job — see apps/crm and apps/wms.
 */
export { pmAvailability, rowsOf, resetAvailabilityCache, type BridgeExecutor } from './executor';
export { BridgeError, isBridgeError, type BridgeErrorCode } from './access';
export { countLinkedWork, listLinkedWork, listOrgPeople, listWritableProjects, projectUrl, taskUrl, type LinkedCounts } from './read';
export { createTaskFromExternal, linkProjectToRecord, plainTextToHtml, removeLink } from './write';
export { emitRecordStatusChange, orgIdForSlug, type EmitResult } from './events';
export * from './types';
