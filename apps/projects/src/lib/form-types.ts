/** Intake form definitions (pm.forms.fields / pm.forms.settings). Pure types. */
import type { Priority } from './constants';

export const FORM_FIELD_TYPES = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'date',
  'select',
  'multiselect',
  'checkbox',
  'url',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** Where an answer lands on the created task. `custom:<fieldId>` writes a custom field. */
export type FormFieldTarget = 'title' | 'description' | 'due_date' | 'priority' | `custom:${string}`;

export interface FormFieldOption {
  readonly id: string;
  readonly label: string;
}

export interface FormField {
  readonly id: string;
  readonly label: string;
  readonly type: FormFieldType;
  readonly required: boolean;
  readonly helpText?: string;
  readonly placeholder?: string;
  readonly options?: readonly FormFieldOption[];
  /** Unmapped answers are appended to the task description as a Q&A list. */
  readonly mapTo?: FormFieldTarget | null;
}

export interface FormSettings {
  readonly statusId?: string;
  readonly sectionId?: string;
  readonly assigneeId?: string | null;
  readonly labelIds?: readonly string[];
  readonly priority?: Priority;
  /** Shown after a successful submit. */
  readonly confirmationMessage?: string;
  /** People notified about each new submission. */
  readonly notifyUserIds?: readonly string[];
  /** Ask for the submitter's name + email (public forms). */
  readonly collectContact?: boolean;
  readonly accentColor?: string;
  /** New responses wait in the project's Triage queue (accept, decline, snooze, merge) instead of becoming tasks right away. */
  readonly sendToTriage?: boolean;
}
