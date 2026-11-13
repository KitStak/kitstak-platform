/**
 * Domain layer barrel. Server-only. Import from '@/server/domain' in server components,
 * route handlers and server actions. Every function takes a `DomainContext` first
 * (build one with `toDomainContext(await requirePageContext())`).
 */
export * from './_shared';
export * from './access';
export * from './activity';
export * from './attachments';
export * from './automations';
export { sweepAutomations, runLinkStatusAutomations, type LinkStatusChange } from './automation-sweep';
export * from './comments';
export * from './forms';
export * from './goals';
export * from './links';
export * from './integration-summary';
export * from './notifications';
export * from './onboarding';
export * from './people';
export * from './portfolio';
export * from './prefs';
export * from './projects';
export * from './search';
export * from './search-full';
export { ensureDueReminders } from './due-reminders';
export * from './spaces';
export * from './structure';
export * from './task-queries';
export * from './tasks';
export * from './templates';
export * from './time';
export * from './views';
export { BUILTIN_TEMPLATES, findBuiltinTemplate, countTemplateTasks } from './templates-builtin';
