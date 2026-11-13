/**
 * Integrations UI (owner: integrations team). Client components only; safe to import from
 * other client components through this index or by path:
 *
 *   RecordChip / RecordStatus / SiblingAppMark   linked CRM/WMS record chip with live status colour
 *   LinkRecordDialog                             pick a record of any connected kind and link it
 *   LinkedRecordsList                            list/chips of a task's or project's links, auto-refreshes stale statuses
 *   Customer360Strip                             live CRM + WMS picture of a project's customer (Overview)
 *   statusTone / TONE_COLOR / targetApp          pure helpers (status meaning → colour, type → app)
 *
 * Server reads live in src/server/integrations; data hooks in src/lib/hooks/use-data.ts
 * (useIntegrationStatus, useIntegrationSearch, useLinkedWork).
 */
export { RecordChip, RecordStatus, SiblingAppMark, type RecordChipTarget } from './record-chip';
export { LinkRecordDialog, type LinkOwner } from './link-record-dialog';
export { LinkedRecordsList } from './linked-records-list';
export { statusTone, TONE_COLOR, targetApp, type StatusTone } from './status-tone';
export { Customer360Strip, useCustomer360, customer360Key } from './customer-360-strip';
