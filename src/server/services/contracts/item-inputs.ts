/**
 * Zod input schemas for items, subitems, updates (comments) and bulk operations.
 * Cell values are validated per column type by the items service (`cellValueSchemaFor`);
 * here they are only constrained structurally.
 */
import { z } from 'zod';
import { placementSchema } from './structure-inputs';

const itemName = z.string().trim().min(1, 'Name is required').max(2_000);
const valuesSchema = z
  .record(z.string().min(1).max(64), z.unknown())
  .refine((value) => Object.keys(value).length <= 200, {
    message: 'Too many columns in one write',
  });

export const createItemSchema = z
  .object({
    name: itemName,
    groupId: z.uuid().optional(),
    parentItemId: z.uuid().optional(),
    values: valuesSchema.optional(),
    /** Put the item at the top of the group instead of the bottom. */
    position: z.enum(['top', 'bottom']).optional(),
  })
  .and(placementSchema);
export type CreateItemInput = z.infer<typeof createItemSchema>;

export const bulkCreateItemsSchema = z.object({
  groupId: z.uuid().optional(),
  items: z
    .array(z.object({ name: itemName, values: valuesSchema.optional() }))
    .min(1)
    .max(500),
});
export type BulkCreateItemsInput = z.infer<typeof bulkCreateItemsSchema>;

export const updateItemSchema = z.object({
  name: itemName.optional(),
  values: valuesSchema.optional(),
});
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

export const setCellSchema = z.object({
  columnKey: z.string().min(1).max(64),
  /** `null` clears the cell. */
  value: z.unknown(),
});
export type SetCellInput = z.infer<typeof setCellSchema>;

export const moveItemSchema = z
  .object({
    groupId: z.uuid().optional(),
    boardId: z.uuid().optional(),
    /** Column-key mapping when moving across boards (source key → target key). */
    columnMapping: z.record(z.string().max(64), z.string().max(64).nullable()).optional(),
  })
  .and(placementSchema);
export type MoveItemInput = z.infer<typeof moveItemSchema>;

export const duplicateItemSchema = z.object({
  withUpdates: z.boolean().default(false),
  withSubitems: z.boolean().default(true),
});
export type DuplicateItemInput = z.infer<typeof duplicateItemSchema>;

export const listItemsQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  groupId: z.uuid().optional(),
  q: z.string().trim().max(200).optional(),
  state: z.enum(['active', 'archived', 'deleted']).default('active'),
});
export type ListItemsQuery = z.infer<typeof listItemsQuerySchema>;

const itemIds = z.array(z.uuid()).min(1).max(500);

export const bulkItemsSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), itemIds, values: valuesSchema }),
  z.object({ action: z.literal('delete'), itemIds }),
  z.object({ action: z.literal('archive'), itemIds }),
  z.object({ action: z.literal('restore'), itemIds }),
  z.object({ action: z.literal('duplicate'), itemIds }),
  z.object({
    action: z.literal('move'),
    itemIds,
    groupId: z.uuid().optional(),
    boardId: z.uuid().optional(),
  }),
]);
export type BulkItemsInput = z.infer<typeof bulkItemsSchema>;

// Updates (comments) ----------------------------------------------------------------------------

/** Tiptap JSON document; sanitized node-by-node by the updates service. */
export const richTextDocSchema = z.object({
  type: z.literal('doc'),
  content: z.array(z.unknown()).max(2_000).optional(),
});

export const createUpdateSchema = z.object({
  body: richTextDocSchema,
  parentUpdateId: z.uuid().optional(),
});
export type CreateUpdateInput = z.infer<typeof createUpdateSchema>;

export const editUpdateSchema = z.object({ body: richTextDocSchema });
export type EditUpdateInput = z.infer<typeof editUpdateSchema>;

export const pinUpdateSchema = z.object({ pinned: z.boolean() });

export const reactionSchema = z.object({
  emoji: z
    .string()
    .min(1)
    .max(32)
    .refine((value) => !/[<>"'`]/.test(value), { message: 'Invalid emoji' }),
});
