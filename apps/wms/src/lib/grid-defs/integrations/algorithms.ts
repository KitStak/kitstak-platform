/** Algorithms grid + editor schemas (M12, spec 06 §2–§4). PURE. */
import { z } from 'zod';
import { ruleConditionSchema, orderByClauseSchema } from '@/lib/domain-types';
import { ACTIVE_PASSIVE, ALGORITHM_KINDS } from '@/lib/enums';
import { requiredId, requiredText, versionField, type IntegrationField } from './common';

export const ALGORITHMS_GRID_KEY = 'algorithms';
export const ALGORITHM_KIND_SLUG = { putaway: 'Putaway', allocation: 'Allocation' } as const;
export type AlgorithmSlug = keyof typeof ALGORITHM_KIND_SLUG;

export const ALGORITHM_FIELDS: readonly IntegrationField[] = [
  { field: 'name', label: 'Name', type: 'text' },
  { field: 'warehouseId', label: 'Warehouse', type: 'enum' },
  { field: 'status', label: 'Status', type: 'enum', options: ACTIVE_PASSIVE },
  { field: 'isDynamicReplenishment', label: 'Dynamic replenishment', type: 'boolean' },
  { field: 'ruleCount', label: 'Rule quantity', type: 'number' },
];
export const ALGORITHM_SORT_FIELDS = ['name', 'warehouseCode', 'status', 'ruleCount', 'updatedAt'] as const;
export const ALGORITHM_SEARCH_FIELDS = ['name'] as const;

export const algorithmActionSchema = z.object({
  action: z.string().trim().min(1).max(80),
  value: z.unknown().optional(),
});

export const algorithmRuleSchema = z.object({
  id: z.string().max(64).optional(),
  name: requiredText('Rule name', 80),
  isActive: z.boolean().default(true),
  conditions: z.array(ruleConditionSchema).max(50).default([]),
  inventoryConditions: z.array(ruleConditionSchema).max(50).default([]),
  actions: z.array(algorithmActionSchema).max(40).default([]),
  orderBy: z.array(orderByClauseSchema).max(12).default([]),
});
export type AlgorithmRuleInput = z.input<typeof algorithmRuleSchema>;
export type AlgorithmRuleSave = z.output<typeof algorithmRuleSchema>;

export const algorithmHeaderSchema = z.object({
  name: requiredText('Algorithm name', 80),
  warehouseId: requiredId('Warehouse'),
  status: z.enum(ACTIVE_PASSIVE),
  isDynamicReplenishment: z.boolean().default(false),
  enforceSuggestedLocations: z.boolean().default(false),
});

export const algorithmSaveSchema = algorithmHeaderSchema
  .extend({
    kind: z.enum(ALGORITHM_KINDS),
    rules: z.array(algorithmRuleSchema).max(30).default([]),
    version: versionField,
  })
  .superRefine((v, ctx) => {
    v.rules.forEach((r, i) => {
      if (v.kind === 'Putaway' && r.actions.length === 0)
        ctx.addIssue({
          code: 'custom',
          path: ['rules', i, 'actions'],
          message: `Rule "${r.name}" needs at least one action`,
        });
      if (v.kind === 'Allocation' && r.actions.length > 0)
        ctx.addIssue({
          code: 'custom',
          path: ['rules', i, 'actions'],
          message: 'Allocation rules use inventory conditions, not actions',
        });
    });
    const names = v.rules.map((r) => r.name.trim().toLowerCase());
    names.forEach((n, i) => {
      if (names.indexOf(n) !== i)
        ctx.addIssue({ code: 'custom', path: ['rules', i, 'name'], message: 'Rule names must be unique' });
    });
  });
export type AlgorithmSave = z.output<typeof algorithmSaveSchema>;
export type AlgorithmSaveInput = z.input<typeof algorithmSaveSchema>;

export const putawayTestSchema = z.object({
  productId: requiredId('Product'),
  qty: z
    .number({ error: 'Quantity is required' })
    .int('Whole units only')
    .min(1, 'Quantity must be at least 1')
    .max(1_000_000),
  fromLocationId: z.string().max(64).nullish(),
  lpId: z.string().max(64).nullish(),
  isReceiving: z.boolean().default(true),
  lot: z.string().max(100).nullish(),
  expiry: z.string().max(40).nullish(),
  damageReason: z.string().max(100).nullish(),
  packType: z.string().max(50).nullish(),
  productionDate: z.string().max(40).nullish(),
  receivedAt: z.string().max(40).nullish(),
  allocatedQty: z.number().int().min(0).max(1_000_000).nullish(),
  /** Unsaved editor state; when present the test runs on the draft in a rolled-back savepoint. */
  draft: z
    .object({ warehouseId: z.string().min(1).max(64), rules: z.array(algorithmRuleSchema).max(30) })
    .optional(),
});
export type PutawayTestInput = z.input<typeof putawayTestSchema>;

export const allocationDryRunSchema = z.object({
  orderId: requiredId('Order'),
  draft: z
    .object({ warehouseId: z.string().min(1).max(64), rules: z.array(algorithmRuleSchema).max(30) })
    .optional(),
});

export const REPLENISHMENT_INFO =
  'At least one replenishment algorithm must be active, so its status and the dynamic replenishment option are locked here. ' +
  'When you choose another algorithm for dynamic replenishment, this one becomes passive. Replenishment algorithms are exclusive and are never used for putaway — ' +
  'keep a separate algorithm for putaway.';
