/**
 * @kitstak/pm-bridge — how CRM and WMS talk to KitStak Projects through the shared database.
 *
 *   Reads   listLinkedWork · countLinkedWork · listWritableProjects · listOrgPeople
 *   Writes  createTaskFromExternal · linkProjectToRecord · removeLink
 *   Events  emitRecordStatusChange (deal stage changed, order shipped…)
 *   Programs listLinkedPrograms · countLinkedPrograms · listProgramsForKit (docs/programs/SPEC.md 6.2, 6.3)
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
export {
  BRIDGE_PROGRAM_STATUS_LABELS,
  countLinkedPrograms,
  listLinkedPrograms,
  listProgramsForKit,
  newProgramUrl,
  programUrl,
  type BridgeProgram,
  type BridgeProgramLinkVia,
  type BridgeProgramStatus,
  type KitProgram,
  type LinkedPrograms,
  type ProgramsForKit,
  type ProgramsUnavailable,
  type ProgramsUnavailableReason,
} from './programs';
export { canSeeProgramMoney } from './permissions';
export { PROGRAM_REFUSAL } from './write';
export * from './types';
