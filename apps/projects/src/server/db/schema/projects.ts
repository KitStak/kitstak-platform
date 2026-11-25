/**
 * pm.projects + per-project structure: members, workflow statuses, list sections, milestones,
 * labels and custom field definitions.
 */
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  CUSTOM_FIELD_TYPES,
  PROJECT_HEALTHS,
  PROJECT_KINDS,
  PROJECT_ROLES,
  PROJECT_STATUSES,
  PROJECT_VISIBILITIES,
  STATUS_CATEGORIES,
} from '@/lib/constants';
import type { CustomFieldConfig } from '@/lib/custom-field-types';
import { createdAt, deletedAt, id, orgId, pmSchema, tstz, updatedAt } from './_shared';
import { spaces } from './workspace';

/** Snapshot of a WMS context a project is tied to (client, warehouse, go-live). */
export interface WmsRef {
  readonly clientId?: string;
  readonly clientCode?: string;
  readonly warehouseId?: string;
  readonly [key: string]: unknown;
}

/** Free-form per-project settings (default view, WIP enforcement, intake defaults…). */
export interface ProjectSettings {
  readonly defaultView?: string;
  readonly enforceWip?: boolean;
  readonly [key: string]: unknown;
}

export const projects = pmSchema.table(
  'projects',
  {
    id: id(),
    orgId: orgId(),
    spaceId: uuid('space_id').references(() => spaces.id, { onDelete: 'set null' }),
    /** Short uppercase key used in task ids (OPS-42). Unique per org among live projects. */
    key: text('key').notNull(),
    /** `program` rows are Programs (recurring work under one price card); fixed after insert (KP102). */
    kind: text('kind', { enum: PROJECT_KINDS }).notNull().default('project'),
    name: text('name').notNull(),
    /** Rich text (sanitized HTML from the editor). */
    description: text('description'),
    status: text('status', { enum: PROJECT_STATUSES }).notNull().default('active'),
    health: text('health', { enum: PROJECT_HEALTHS }).notNull().default('on_track'),
    /** Short status-update note shown next to health ("Waiting on carrier contract"). */
    healthNote: text('health_note'),
    ownerId: uuid('owner_id'),
    startDate: date('start_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    color: text('color').notNull().default('blue'),
    icon: text('icon').notNull().default('folder-kanban'),
    visibility: text('visibility', { enum: PROJECT_VISIBILITIES }).notNull().default('org'),
    /** core.customers.id (shared customer registry; FK in SQL, ON DELETE SET NULL). */
    crmCustomerId: uuid('crm_customer_id'),
    /** crm.items.id of the CRM deal/account this project delivers. */
    crmItemId: uuid('crm_item_id'),
    wmsRef: jsonb('wms_ref').$type<WmsRef>(),
    isTemplate: boolean('is_template').notNull().default(false),
    /** pm.templates.id the project was created from (or null). */
    templateId: uuid('template_id'),
    /** Last issued task number (tasks.number = ++task_seq, atomically). */
    taskSeq: integer('task_seq').notNull().default(0),
    position: text('position').notNull(),
    settings: jsonb('settings').$type<ProjectSettings>().notNull().default(sql`'{}'::jsonb`),
    completedAt: tstz('completed_at'),
    archivedAt: tstz('archived_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('projects_org_key_live_unique').on(t.orgId, t.key).where(sql`${t.deletedAt} IS NULL`),
    index('projects_org_idx').on(t.orgId).where(sql`${t.deletedAt} IS NULL`),
    index('projects_space_idx').on(t.spaceId),
    index('projects_crm_item_idx').on(t.crmItemId),
    index('projects_crm_customer_idx').on(t.crmCustomerId),
    index('projects_org_kind_idx').on(t.orgId, t.kind).where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const projectMembers = pmSchema.table(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    orgId: orgId(),
    role: text('role', { enum: PROJECT_ROLES }).notNull().default('editor'),
    addedBy: uuid('added_by'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'project_members_pkey', columns: [t.projectId, t.userId] }),
    index('project_members_user_idx').on(t.orgId, t.userId),
  ],
);

/** Per-project workflow columns (Board columns). */
export const statuses = pmSchema.table(
  'statuses',
  {
    id: id(),
    orgId: orgId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category', { enum: STATUS_CATEGORIES }).notNull(),
    color: text('color').notNull().default('gray'),
    position: text('position').notNull(),
    /** Board WIP limit (null = unlimited). */
    wipLimit: integer('wip_limit'),
    /** New tasks land here when no status is given (exactly one per project). */
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('statuses_project_idx').on(t.projectId)],
);

/** List-view grouping ("Planning", "Launch week"). */
export const sections = pmSchema.table(
  'sections',
  {
    id: id(),
    orgId: orgId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: text('position').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sections_project_idx').on(t.projectId)],
);

export const milestones = pmSchema.table(
  'milestones',
  {
    id: id(),
    orgId: orgId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    dueDate: date('due_date', { mode: 'string' }),
    completedAt: tstz('completed_at'),
    position: text('position').notNull(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('milestones_project_idx').on(t.projectId)],
);

/** Labels. `project_id` null = available in every project of the org. */
export const labels = pmSchema.table(
  'labels',
  {
    id: id(),
    orgId: orgId(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('gray'),
    createdAt: createdAt(),
  },
  (t) => [index('labels_org_project_idx').on(t.orgId, t.projectId)],
);

/** Custom field definitions. Values live in `tasks.custom_fields[<field id>]`. */
export const customFields = pmSchema.table(
  'custom_fields',
  {
    id: id(),
    orgId: orgId(),
    /** null = workspace-wide field shown in every project. */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type', { enum: CUSTOM_FIELD_TYPES }).notNull(),
    config: jsonb('config').$type<CustomFieldConfig>().notNull().default(sql`'{}'::jsonb`),
    description: text('description'),
    required: boolean('required').notNull().default(false),
    position: text('position').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('custom_fields_org_project_idx').on(t.orgId, t.projectId)],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type Status = typeof statuses.$inferSelect;
export type Section = typeof sections.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
export type Label = typeof labels.$inferSelect;
export type CustomField = typeof customFields.$inferSelect;

export type { CustomFieldConfig, CustomFieldOption } from '@/lib/custom-field-types';
