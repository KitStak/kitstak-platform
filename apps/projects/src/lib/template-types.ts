/**
 * Project template payload (pm.templates.payload and the built-ins in
 * src/server/domain/templates-builtin.ts). Everything references siblings by `key`, never by
 * database id; `instantiateTemplate` maps keys to fresh ids. Dates are offsets in days from the
 * project start date.
 */
import type { CustomFieldType, LabelColor, Priority, StatusCategory, ViewType } from './constants';
import type { AutomationAction, AutomationCondition, AutomationTrigger } from './automation-types';
import type { CustomFieldConfig } from './custom-field-types';

export interface TemplateStatus {
  readonly key: string;
  readonly name: string;
  readonly category: StatusCategory;
  readonly color: LabelColor | string;
  readonly wipLimit?: number | null;
  readonly isDefault?: boolean;
}

export interface TemplateSection {
  readonly key: string;
  readonly name: string;
}

export interface TemplateLabel {
  readonly key: string;
  readonly name: string;
  readonly color: LabelColor | string;
}

export interface TemplateCustomField {
  readonly key: string;
  readonly name: string;
  readonly type: CustomFieldType;
  readonly config?: CustomFieldConfig;
}

export interface TemplateMilestone {
  readonly key: string;
  readonly name: string;
  readonly dueOffsetDays?: number;
}

export interface TemplateTask {
  readonly key?: string;
  readonly title: string;
  readonly description?: string;
  readonly statusKey?: string;
  readonly sectionKey?: string;
  readonly priority?: Priority;
  readonly startOffsetDays?: number;
  readonly dueOffsetDays?: number;
  readonly labelKeys?: readonly string[];
  readonly milestoneKey?: string;
  readonly isMilestone?: boolean;
  readonly estimatePoints?: number;
  readonly subtasks?: readonly TemplateTask[];
}

/**
 * Automations inside templates use keys in place of ids: any `statusId`, `toStatusId`,
 * `labelId` or `sectionId` value is a template key and is remapped on instantiation.
 */
export interface TemplateAutomation {
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly conditions?: readonly AutomationCondition[];
  readonly actions: readonly AutomationAction[];
}

export interface TemplatePayload {
  readonly description?: string;
  readonly color?: LabelColor | string;
  readonly icon?: string;
  /** Suggested project length (sets the due date). */
  readonly durationDays?: number;
  readonly defaultView?: ViewType;
  /** Ask for a CRM customer when creating (Client onboarding, Warehouse go-live). */
  readonly asksForCustomer?: boolean;
  readonly statuses: readonly TemplateStatus[];
  readonly sections?: readonly TemplateSection[];
  readonly labels?: readonly TemplateLabel[];
  readonly customFields?: readonly TemplateCustomField[];
  readonly milestones?: readonly TemplateMilestone[];
  readonly tasks?: readonly TemplateTask[];
  readonly dependencies?: readonly { readonly blockingKey: string; readonly blockedKey: string }[];
  readonly automations?: readonly TemplateAutomation[];
}
