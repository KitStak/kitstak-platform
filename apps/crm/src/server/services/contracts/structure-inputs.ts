/**
 * Zod input schemas for workspace / folder / board / column / group / view mutations.
 * Pure (zod + pure schema modules) — shared by route handlers, services and client forms.
 */
import { z } from 'zod';
import { COLUMN_TYPES, LABEL_COLORS, shortIdSchema } from '@/server/db/schema/cell-values';

const name = z.string().trim().min(1, 'Name is required').max(255);
const optionalText = z.string().trim().max(2_000).nullish();
export const colorSchema = z.enum(LABEL_COLORS);
const iconSchema = z.string().trim().min(1).max(64).nullish();

/** Relative placement among siblings. Omit both to append. */
export const placementSchema = z
  .object({
    afterId: z.uuid().nullish(),
    beforeId: z.uuid().nullish(),
  })
  .refine((value) => !(value.afterId && value.beforeId), {
    message: 'Provide either afterId or beforeId, not both',
  });
export type Placement = z.infer<typeof placementSchema>;

// Workspaces ----------------------------------------------------------------------------------

export const createWorkspaceSchema = z.object({
  name,
  description: optionalText,
  icon: iconSchema,
  color: colorSchema.default('blue'),
  kind: z.enum(['open', 'closed']).default('open'),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z
  .object({
    name: name.optional(),
    description: optionalText,
    icon: iconSchema,
    color: colorSchema.optional(),
    kind: z.enum(['open', 'closed']).optional(),
  })
  .and(placementSchema);
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

// Folders --------------------------------------------------------------------------------------

export const createFolderSchema = z.object({
  workspaceId: z.uuid(),
  parentId: z.uuid().nullish(),
  name,
  color: colorSchema.nullish(),
});
export type CreateFolderInput = z.infer<typeof createFolderSchema>;

export const updateFolderSchema = z
  .object({
    name: name.optional(),
    color: colorSchema.nullish(),
    parentId: z.uuid().nullish(),
  })
  .and(placementSchema);
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;

// Boards ---------------------------------------------------------------------------------------

export const BOARD_KINDS = [
  'leads',
  'contacts',
  'accounts',
  'deals',
  'activities',
  'projects',
  'custom',
] as const;
export const boardKindSchema = z.enum(BOARD_KINDS);
export const boardPrivacySchema = z.enum(['main', 'private', 'shareable']);

export const createBoardSchema = z.object({
  workspaceId: z.uuid(),
  folderId: z.uuid().nullish(),
  name,
  kind: boardKindSchema.optional(),
  description: optionalText,
  icon: iconSchema,
  privacy: boardPrivacySchema.default('main'),
  itemTerminology: z.string().trim().min(1).max(40).optional(),
  /** Board template id (see `GET /boards/templates`). Defaults to a blank board. */
  templateId: z.string().max(64).optional(),
  /** When false, template boards are created without demo rows. */
  withSampleData: z.boolean().default(false),
});
export type CreateBoardInput = z.infer<typeof createBoardSchema>;

export const updateBoardSchema = z
  .object({
    name: name.optional(),
    description: optionalText,
    icon: iconSchema,
    privacy: boardPrivacySchema.optional(),
    itemTerminology: z.string().trim().min(1).max(40).optional(),
    folderId: z.uuid().nullish(),
    workspaceId: z.uuid().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .and(placementSchema);
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;

export const duplicateBoardSchema = z.object({
  name: name.optional(),
  /** `structure` = columns, groups & views only; `items` adds items; `items_updates` adds comments. */
  mode: z.enum(['structure', 'items', 'items_updates']).default('items'),
  workspaceId: z.uuid().optional(),
  folderId: z.uuid().nullish(),
});
export type DuplicateBoardInput = z.infer<typeof duplicateBoardSchema>;

export const boardMembersSchema = z.object({
  members: z
    .array(z.object({ userId: z.uuid(), role: z.enum(['owner', 'editor', 'viewer', 'subscriber']) }))
    .max(500),
});
export type BoardMembersInput = z.infer<typeof boardMembersSchema>;

export const listBoardsQuerySchema = z.object({
  workspaceId: z.uuid().optional(),
  kind: boardKindSchema.optional(),
  state: z.enum(['active', 'archived', 'deleted']).default('active'),
});
export type ListBoardsQuery = z.infer<typeof listBoardsQuerySchema>;

// Columns --------------------------------------------------------------------------------------

export const columnTypeSchema = z.enum(COLUMN_TYPES);

export const createColumnSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    type: columnTypeSchema,
    description: optionalText,
    key: shortIdSchema.max(48).optional(),
    scope: z.enum(['item', 'subitem']).default('item'),
    settings: z.unknown().optional(),
    width: z.number().int().min(40).max(1_200).optional(),
    hidden: z.boolean().default(false),
  })
  .and(placementSchema);
export type CreateColumnInput = z.infer<typeof createColumnSchema>;

export const updateColumnSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    description: optionalText,
    settings: z.unknown().optional(),
    width: z.number().int().min(40).max(1_200).optional(),
    hidden: z.boolean().optional(),
    required: z.boolean().optional(),
    /** Change the column type. Values are converted where possible, otherwise cleared. */
    type: columnTypeSchema.optional(),
  })
  .and(placementSchema);
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;

// Groups ---------------------------------------------------------------------------------------

export const createGroupSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    color: colorSchema.optional(),
  })
  .and(placementSchema);
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    color: colorSchema.optional(),
    collapsedDefault: z.boolean().optional(),
    /** Move the whole group (and its items) to another board in the org. */
    targetBoardId: z.uuid().optional(),
  })
  .and(placementSchema);
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

// Views ----------------------------------------------------------------------------------------

export const viewTypeSchema = z.enum([
  'table',
  'kanban',
  'calendar',
  'timeline',
  'chart',
  'form',
  'dashboard',
  'files',
]);

const filterRuleSchema = z.object({
  columnKey: z.string().max(64),
  operator: z.enum([
    'is',
    'is_not',
    'contains',
    'not_contains',
    'is_empty',
    'is_not_empty',
    'gt',
    'gte',
    'lt',
    'lte',
    'between',
    'before',
    'after',
    'any_of',
    'none_of',
    // Rich operators compiled client-side by `@/lib/filter-tree`.
    'eq',
    'neq',
    'range',
    'within',
  ]),
  value: z.unknown().optional(),
});

interface FilterGroupInput {
  conjunction: 'and' | 'or';
  rules: z.infer<typeof filterRuleSchema>[];
  groups?: FilterGroupInput[];
}

/** Nested condition groups (the UI nests one level; two are accepted). */
const nestedFilterGroupSchema = (depth: number): z.ZodType<FilterGroupInput> =>
  z.object({
    conjunction: z.enum(['and', 'or']).default('and'),
    rules: z.array(filterRuleSchema).max(50).default([]),
    ...(depth > 0 ? { groups: z.array(nestedFilterGroupSchema(depth - 1)).max(20).optional() } : {}),
  }) as unknown as z.ZodType<FilterGroupInput>;

export const viewConfigSchema = z
  .object({
    filters: z
      .object({
        conjunction: z.enum(['and', 'or']).default('and'),
        rules: z.array(filterRuleSchema).max(50).default([]),
        groups: z.array(nestedFilterGroupSchema(1)).max(20).optional(),
      })
      .optional(),
    sort: z
      .array(z.object({ columnKey: z.string().max(64), direction: z.enum(['asc', 'desc']) }))
      .max(10)
      .optional(),
    groupBy: z.string().max(64).nullish(),
    hiddenColumnKeys: z.array(z.string().max(64)).max(200).optional(),
    columnOrder: z.array(z.string().max(64)).max(200).optional(),
    columnWidths: z.record(z.string().max(64), z.number().int().min(40).max(1_200)).optional(),
    search: z.string().max(200).optional(),
    personFilter: z.uuid().nullish(),
    kanbanColumnKey: z.string().max(64).optional(),
    kanbanCardColumnKeys: z.array(z.string().max(64)).max(20).optional(),
    dateColumnKey: z.string().max(64).optional(),
    endDateColumnKey: z.string().max(64).optional(),
    chart: z
      .object({
        type: z.enum(['bar', 'stacked_bar', 'line', 'pie', 'donut', 'area']),
        xColumnKey: z.string().max(64).optional(),
        yColumnKey: z.string().max(64).nullish(),
        aggregate: z.enum(['count', 'sum', 'average', 'min', 'max']).default('count'),
      })
      .optional(),
    density: z.enum(['compact', 'default', 'comfortable']).optional(),
    formColumnKeys: z.array(z.string().max(64)).max(100).optional(),
  })
  .catchall(z.unknown());
export type ViewConfigInput = z.infer<typeof viewConfigSchema>;

export const createViewSchema = z
  .object({
    type: viewTypeSchema,
    name: z.string().trim().min(1).max(120),
    config: viewConfigSchema.default({}),
    personal: z.boolean().default(false),
  })
  .and(placementSchema);
export type CreateViewInput = z.infer<typeof createViewSchema>;

export const updateViewSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    config: viewConfigSchema.optional(),
    /** Shallow-merge into the stored config instead of replacing it. */
    mergeConfig: z.boolean().default(true),
    isDefault: z.boolean().optional(),
  })
  .and(placementSchema);
export type UpdateViewInput = z.infer<typeof updateViewSchema>;
