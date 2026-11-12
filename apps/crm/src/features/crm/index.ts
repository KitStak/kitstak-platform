/**
 * CRM module: pipeline cockpit, Contact/Account 360, lead conversion wizard, activity logging
 * and duplicate management. Entry points for other modules:
 *
 *   <ConvertLeadDialog itemId open onOpenChange />      — Leads → Account + Contact (+ Deal)
 *   <LogActivityDialog itemId open onOpenChange />      — log a call/email/meeting on a contact, account or deal
 *   <CrmItemActions itemId itemName boardKind canEdit /> — item panel header buttons (Convert / 360 / Log)
 *   <CrmSidebarSection collapsed? />                    — CRM object nav for the shell sidebar
 */
export { ConvertLeadDialog, type ConvertLeadDialogProps } from './convert/convert-lead-dialog';
export { LogActivityDialog, type LogActivityDialogProps } from './records/log-activity-dialog';
export { ActivityComposer } from './records/activity-composer';
export { CrmItemActions, type CrmItemActionsProps } from './nav/crm-item-actions';
export { CrmSidebarSection } from './nav/crm-sidebar-section';
export { PipelinePage } from './pipeline/pipeline-page';
export { Record360Page } from './records/record-360-page';
export { DuplicatesPage } from './duplicates/duplicates-page';
export { crmKeys, useCrmBoards } from './api';
