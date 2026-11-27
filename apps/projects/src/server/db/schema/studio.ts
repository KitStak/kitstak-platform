/** Automations, templates and intake forms. */
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { AUTOMATION_RUN_STATUSES, TEMPLATE_KINDS } from '@/lib/constants';
import type { AutomationAction, AutomationCondition, AutomationTrigger } from '@/lib/automation-types';
import type { TemplatePayload } from '@/lib/template-types';
import type { FormField, FormSettings } from '@/lib/form-types';
import { createdAt, deletedAt, id, orgId, pmSchema, tstz, updatedAt } from './_shared';
import { projects } from './projects';
import { tasks } from './tasks';

/** "When <trigger> and <conditions>, do <actions>." Evaluated by src/server/automations/engine.ts. */
export const automations = pmSchema.table(
  'automations',
  {
    id: id(),
    orgId: orgId(),
    /** null = runs in every project of the org. */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    enabled: boolean('enabled').notNull().default(true),
    trigger: jsonb('trigger').$type<AutomationTrigger>().notNull(),
    conditions: jsonb('conditions').$type<AutomationCondition[]>().notNull().default(sql`'[]'::jsonb`),
    actions: jsonb('actions').$type<AutomationAction[]>().notNull().default(sql`'[]'::jsonb`),
    runCount: integer('run_count').notNull().default(0),
    lastRunAt: tstz('last_run_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('automations_org_project_idx').on(t.orgId, t.projectId)],
);

export const automationRuns = pmSchema.table(
  'automation_runs',
  {
    id: id(),
    orgId: orgId(),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    status: text('status', { enum: AUTOMATION_RUN_STATUSES }).notNull(),
    /** Plain-language summary ("Moved OPS-4 to Done"). */
    summary: text('summary'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index('automation_runs_automation_idx').on(t.automationId, t.createdAt)],
);

/** Org-saved project templates (built-in templates live in src/server/domain/templates-builtin.ts). */
export const templates = pmSchema.table(
  'templates',
  {
    id: id(),
    orgId: orgId(),
    /** `program` templates open in the program wizard; the project gallery lists `project` only. */
    kind: text('kind', { enum: TEMPLATE_KINDS }).notNull().default('project'),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category').notNull().default('General'),
    icon: text('icon').notNull().default('layout-template'),
    color: text('color').notNull().default('blue'),
    payload: jsonb('payload').$type<TemplatePayload>().notNull(),
    sourceProjectId: uuid('source_project_id').references(() => projects.id, { onDelete: 'set null' }),
    useCount: integer('use_count').notNull().default(0),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('templates_org_idx').on(t.orgId),
    index('templates_org_kind_idx').on(t.orgId, t.kind).where(sql`${t.deletedAt} IS NULL`),
  ],
);

/** Public intake form → creates a task in `project_id`. Served at /forms/<id>. */
export const forms = pmSchema.table(
  'forms',
  {
    id: id(),
    orgId: orgId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    fields: jsonb('fields').$type<FormField[]>().notNull().default(sql`'[]'::jsonb`),
    settings: jsonb('settings').$type<FormSettings>().notNull().default(sql`'{}'::jsonb`),
    /** Anyone with the link can submit (no sign-in). When false, only signed-in org members can. */
    isPublic: boolean('is_public').notNull().default(true),
    enabled: boolean('enabled').notNull().default(true),
    /** Unguessable public token used in the share URL (/forms/<token>). */
    publicToken: text('public_token').notNull(),
    submissionCount: integer('submission_count').notNull().default(0),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('forms_public_token_unique').on(t.publicToken),
    index('forms_project_idx').on(t.projectId),
  ],
);

export const formSubmissions = pmSchema.table(
  'form_submissions',
  {
    id: id(),
    orgId: orgId(),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    submitterName: text('submitter_name'),
    submitterEmail: text('submitter_email'),
    submittedBy: uuid('submitted_by'),
    createdAt: createdAt(),
  },
  (t) => [index('form_submissions_form_idx').on(t.formId, t.createdAt)],
);

export type Automation = typeof automations.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type Template = typeof templates.$inferSelect;
export type Form = typeof forms.$inferSelect;
export type FormSubmission = typeof formSubmissions.$inferSelect;
