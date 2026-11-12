/**
 * Automation recipe schemas: "When <trigger>, if <conditions>, then <actions>".
 * Pure (zod only) — the automation builder UI can import these to validate drafts.
 */
import { z } from 'zod';

const columnKey = z.string().min(1).max(64);
const labelId = z.string().min(1).max(64);

export const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('item_created'), config: z.object({}).strict().default({}) }),
  z.object({
    type: z.literal('status_changed'),
    config: z.object({
      columnKey,
      /** Fire only when the new label is this one (any change when omitted). */
      toLabelId: labelId.optional(),
      fromLabelId: labelId.optional(),
    }),
  }),
  z.object({ type: z.literal('column_changed'), config: z.object({ columnKey }) }),
  z.object({
    type: z.literal('person_assigned'),
    config: z.object({ columnKey, userId: z.uuid().optional() }),
  }),
  z.object({
    type: z.literal('date_arrived'),
    config: z.object({ columnKey, offsetDays: z.number().int().min(-365).max(365).default(0) }),
  }),
  z.object({ type: z.literal('item_moved_to_group'), config: z.object({ groupId: z.uuid() }) }),
]);
export type AutomationTriggerRecipe = z.infer<typeof triggerSchema>;

export const conditionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('status_is'),
    config: z.object({ columnKey, labelIds: z.array(labelId).min(1).max(50) }),
  }),
  z.object({ type: z.literal('column_is_empty'), config: z.object({ columnKey }) }),
  z.object({ type: z.literal('column_not_empty'), config: z.object({ columnKey }) }),
  z.object({ type: z.literal('in_group'), config: z.object({ groupId: z.uuid() }) }),
  z.object({
    type: z.literal('number_compare'),
    config: z.object({
      columnKey,
      operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']),
      value: z.number().finite(),
    }),
  }),
  z.object({ type: z.literal('person_is'), config: z.object({ columnKey, userId: z.uuid() }) }),
]);
export type AutomationConditionRecipe = z.infer<typeof conditionSchema>;

const messageTemplate = z.string().trim().min(1).max(2_000);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_column'), config: z.object({ columnKey, value: z.unknown() }) }),
  z.object({ type: z.literal('set_status'), config: z.object({ columnKey, labelId }) }),
  z.object({ type: z.literal('clear_column'), config: z.object({ columnKey }) }),
  z.object({
    type: z.literal('set_date'),
    config: z.object({ columnKey, offsetDays: z.number().int().min(-3650).max(3650).default(0) }),
  }),
  z.object({ type: z.literal('move_to_group'), config: z.object({ groupId: z.uuid() }) }),
  z.object({
    type: z.literal('notify'),
    config: z
      .object({
        userIds: z.array(z.uuid()).max(50).default([]),
        /** Also notify everyone in this people column of the item. */
        peopleColumnKey: columnKey.optional(),
        message: messageTemplate,
      })
      .refine((value) => value.userIds.length > 0 || value.peopleColumnKey, {
        message: 'Choose who to notify',
      }),
  }),
  z.object({
    type: z.literal('assign_person'),
    config: z.object({
      columnKey,
      userIds: z.array(z.uuid()).max(50).default([]),
      /** Assign the user whose action triggered the automation. */
      assignActor: z.boolean().default(false),
      mode: z.enum(['add', 'replace']).default('add'),
    }),
  }),
  z.object({
    type: z.literal('create_item'),
    config: z.object({
      boardId: z.uuid(),
      groupId: z.uuid().optional(),
      /** Supports `{name}` and `{board}` placeholders. */
      nameTemplate: z.string().trim().min(1).max(500).default('{name}'),
      /** Copy values: source column key → target column key (same type). */
      copyValues: z.record(columnKey, columnKey).default({}),
      /** Connect column on the target board to link back to the source item. */
      linkColumnKey: columnKey.optional(),
    }),
  }),
  z.object({ type: z.literal('create_update'), config: z.object({ body: messageTemplate }) }),
  z.object({ type: z.literal('archive_item'), config: z.object({}).strict().default({}) }),
]);
export type AutomationActionRecipe = z.infer<typeof actionSchema>;

export const automationRecipeSchema = z.object({
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1).max(10),
});
export type AutomationRecipe = z.infer<typeof automationRecipeSchema>;

export const createAutomationSchema = automationRecipeSchema.extend({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2_000).nullish(),
  enabled: z.boolean().default(true),
});
export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;

export const updateAutomationSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(2_000).nullish(),
  enabled: z.boolean().optional(),
  trigger: triggerSchema.optional(),
  conditions: z.array(conditionSchema).max(10).optional(),
  actions: z.array(actionSchema).min(1).max(10).optional(),
});
export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>;

/** Column keys a recipe references on its own board (for validation against the board). */
export function referencedColumnKeys(recipe: {
  trigger: AutomationTriggerRecipe;
  conditions: readonly AutomationConditionRecipe[];
  actions: readonly AutomationActionRecipe[];
}): string[] {
  const keys = new Set<string>();
  const add = (config: unknown, field: string) => {
    const value = (config as Record<string, unknown>)[field];
    if (typeof value === 'string') keys.add(value);
  };
  add(recipe.trigger.config, 'columnKey');
  for (const condition of recipe.conditions) add(condition.config, 'columnKey');
  for (const action of recipe.actions) {
    if (action.type === 'create_item') continue;
    add(action.config, 'columnKey');
    add(action.config, 'peopleColumnKey');
  }
  return [...keys];
}
