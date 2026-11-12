/** Workflows grid + builder schemas (M12; KitStak-designed, spec 06 §5 / Part D). PURE. */
import { z } from 'zod';
import { isConditionGroup, ruleConditionNodeSchema } from '@/lib/domain-types';
import { MATCH_MODES, PRIORITIES, WORKFLOW_ACTIONS, WORKFLOW_TRIGGERS } from '@/lib/enums';
import { optionalId, requiredText, versionField, type IntegrationField } from './common';
import { fieldDef } from './rule-fields';

export const WORKFLOWS_GRID_KEY = 'workflows';
export const WORKFLOW_RUNS_GRID_KEY = 'workflow-runs';

export type WorkflowActionName = (typeof WORKFLOW_ACTIONS)[number];
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

export const WORKFLOW_FIELDS: readonly IntegrationField[] = [
  { field: 'name', label: 'Name', type: 'text' },
  { field: 'trigger', label: 'Trigger', type: 'enum', options: WORKFLOW_TRIGGERS },
  { field: 'warehouseId', label: 'Warehouse', type: 'enum' },
  { field: 'clientId', label: 'Client', type: 'enum' },
  { field: 'isActive', label: 'Active', type: 'boolean' },
  { field: 'runCount', label: 'Runs', type: 'number' },
  { field: 'lastRunAt', label: 'Last run', type: 'date' },
];
export const WORKFLOW_SORT_FIELDS = [
  'sequence',
  'name',
  'trigger',
  'runCount',
  'lastRunAt',
  'isActive',
  'updatedAt',
] as const;
export const WORKFLOW_SEARCH_FIELDS = ['name', 'description'] as const;

export const WORKFLOW_RUN_FIELDS: readonly IntegrationField[] = [
  { field: 'matched', label: 'Matched', type: 'boolean' },
  { field: 'blockType', label: 'Block type', type: 'enum', options: ['Fully', 'Partially'] },
  { field: 'orderCode', label: 'Order', type: 'text' },
  { field: 'at', label: 'Run date', type: 'date' },
];
export const WORKFLOW_RUN_SORT_FIELDS = ['at', 'orderCode', 'matched'] as const;

export interface ActionParamDef {
  readonly key: string;
  readonly label: string;
  readonly kind:
    | 'text'
    | 'textarea'
    | 'priority'
    | 'carrier-service'
    | 'preset'
    | 'warehouse'
    | 'package'
    | 'order-type'
    | 'users';
  readonly required: boolean;
  readonly placeholder?: string;
}

/** Params per action; drives the builder form and server validation. */
export const ACTION_PARAMS: Readonly<Record<WorkflowActionName, readonly ActionParamDef[]>> = {
  'Block Order': [
    {
      key: 'reason',
      label: 'Reason shown to the team',
      kind: 'text',
      required: false,
      placeholder: 'e.g. PO box address, confirm a street address',
    },
  ],
  'Partially Block Order': [
    {
      key: 'reason',
      label: 'Reason shown to the team',
      kind: 'text',
      required: false,
      placeholder: 'e.g. Review gift message',
    },
  ],
  'Set Carrier Service': [
    { key: 'carrierServiceId', label: 'Carrier service', kind: 'carrier-service', required: true },
  ],
  'Set Rate Shopping Preset': [
    { key: 'presetId', label: 'Rate shopping preset', kind: 'preset', required: true },
  ],
  'Set Priority': [{ key: 'priority', label: 'Priority', kind: 'priority', required: true }],
  'Add Tag': [{ key: 'tag', label: 'Tag', kind: 'text', required: true, placeholder: 'e.g. VIP' }],
  'Set Warehouse': [{ key: 'warehouseId', label: 'Warehouse', kind: 'warehouse', required: true }],
  'Set Shipment Package': [
    { key: 'shipmentPackageId', label: 'Shipment package', kind: 'package', required: true },
  ],
  'Set Order Type': [{ key: 'orderTypeId', label: 'Order type', kind: 'order-type', required: true }],
  'Add Note': [
    {
      key: 'note',
      label: 'Note',
      kind: 'textarea',
      required: true,
      placeholder: 'Appended to the order note',
    },
  ],
  'Notify Users': [
    { key: 'userIds', label: 'Users', kind: 'users', required: true },
    {
      key: 'message',
      label: 'Message',
      kind: 'textarea',
      required: false,
      placeholder: 'Optional; defaults to the workflow and order code',
    },
  ],
};

export const ACTION_COPY: Readonly<Record<WorkflowActionName, string>> = {
  'Block Order': 'Stops allocation until someone releases it in Workflow Blocked.',
  'Partially Block Order': 'Flags the order for review; it can still allocate.',
  'Set Carrier Service': 'Assigns a specific carrier service (clears any preset).',
  'Set Rate Shopping Preset': "Rate-shops at label time with a preset of the order's client.",
  'Set Priority': 'Changes the order priority used by waves and jobs.',
  'Add Tag': "Adds a tag; it's created if it doesn't exist.",
  'Set Warehouse': 'Moves the open order to another warehouse.',
  'Set Shipment Package': 'Pre-selects the box packers should use.',
  'Set Order Type': 'Sets the Data Setup order type.',
  'Add Note': 'Appends text to the order note.',
  'Notify Users': 'Sends an in-app notification with a link to the order.',
};

/** When each trigger fires (every one is dispatched by the server; see TRIGGER_SOURCES in the progress notes). */
export const TRIGGER_COPY: Readonly<Record<WorkflowTrigger, string>> = {
  'Shipment Order Created':
    'Any new order: created in the app, through the API, downloaded from a channel or imported.',
  'Shipment Order Imported':
    'Only orders downloaded from a sales channel or imported from Excel/CSV (runs before Created workflows).',
  'Shipment Order Updated': "An open order's header or lines are edited.",
  'Purchase Order Created': 'A purchase order is created in the app, through the API or by import.',
  'Order Shipped': 'Ship confirm marks an order Shipped or Partially Shipped.',
};

/** Purchase-order triggers can only notify (order actions don't apply to POs). */
export const PO_TRIGGERS: ReadonlySet<WorkflowTrigger> = new Set(['Purchase Order Created']);
/** After shipping only non-changing actions make sense. */
const SHIPPED_ACTIONS: readonly WorkflowActionName[] = ['Add Tag', 'Notify Users'];
export const actionsForTrigger = (trigger: WorkflowTrigger | null): readonly WorkflowActionName[] =>
  trigger && PO_TRIGGERS.has(trigger)
    ? ['Notify Users']
    : trigger === 'Order Shipped'
      ? SHIPPED_ACTIONS
      : WORKFLOW_ACTIONS;
/** Condition field catalog for a trigger (rule-fields.ts CONDITION_CATALOGS key). */
export const conditionCatalogForTrigger = (trigger: WorkflowTrigger | null): 'order' | 'purchaseOrder' =>
  trigger && PO_TRIGGERS.has(trigger) ? 'purchaseOrder' : 'order';

export const workflowActionSchema = z.object({
  action: z.enum(WORKFLOW_ACTIONS),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const workflowSaveSchema = z
  .object({
    name: requiredText('Workflow name', 80),
    description: z
      .string()
      .trim()
      .max(500)
      .optional()
      .nullable()
      .transform((v) => v || null),
    trigger: z.enum(WORKFLOW_TRIGGERS, { error: 'Choose a trigger' }),
    warehouseId: optionalId(),
    clientId: optionalId(),
    match: z.enum(MATCH_MODES),
    conditions: z.array(ruleConditionNodeSchema).max(50).default([]),
    actions: z.array(workflowActionSchema).max(20),
    isActive: z.boolean(),
    stopProcessing: z.boolean(),
    version: versionField,
  })
  .superRefine((v, ctx) => {
    if (v.actions.length === 0)
      ctx.addIssue({ code: 'custom', path: ['actions'], message: 'Add at least one action' });
    const allowed = actionsForTrigger(v.trigger);
    const catalog = conditionCatalogForTrigger(v.trigger);
    const badField = (field: string) =>
      `${field} isn't a ${catalog === 'purchaseOrder' ? 'purchase order' : 'shipment order'} field; remove it or change the trigger`;
    v.conditions.forEach((c, i) => {
      if (isConditionGroup(c)) {
        c.conditions.forEach((g, j) => {
          if (!fieldDef(catalog, g.field))
            ctx.addIssue({
              code: 'custom',
              path: ['conditions', i, 'conditions', j, 'field'],
              message: badField(g.field),
            });
        });
      } else if (!fieldDef(catalog, c.field))
        ctx.addIssue({ code: 'custom', path: ['conditions', i, 'field'], message: badField(c.field) });
    });
    v.actions.forEach((a, i) => {
      if (!allowed.includes(a.action))
        ctx.addIssue({
          code: 'custom',
          path: ['actions', i, 'action'],
          message: `${a.action} isn't available for ${v.trigger}`,
        });
      for (const p of ACTION_PARAMS[a.action]) {
        const val = a.params[p.key];
        const empty =
          val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0);
        if (p.required && empty)
          ctx.addIssue({
            code: 'custom',
            path: ['actions', i, 'params', p.key],
            message: `${p.label} is required`,
          });
        if (p.kind === 'priority' && !empty && !PRIORITIES.includes(val as (typeof PRIORITIES)[number]))
          ctx.addIssue({
            code: 'custom',
            path: ['actions', i, 'params', p.key],
            message: 'Choose a priority',
          });
      }
    });
    const blocks = v.actions.filter(
      (a) => a.action === 'Block Order' || a.action === 'Partially Block Order',
    ).length;
    if (blocks > 1)
      ctx.addIssue({ code: 'custom', path: ['actions'], message: 'Use one block action per workflow' });
  });
export type WorkflowSaveInput = z.input<typeof workflowSaveSchema>;
export type WorkflowSave = z.output<typeof workflowSaveSchema>;

export const workflowTestSchema = z.object({
  orderId: z.string().trim().min(1, 'Choose an order').max(64),
  draft: workflowSaveSchema.optional(),
});

export const reorderSchema = z.object({ ids: z.array(z.string().trim().min(1).max(64)).min(1).max(500) });
export const bulkActiveSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(64)).min(1).max(1000),
  isActive: z.boolean(),
});

export const WORKFLOW_DEFAULTS: WorkflowSaveInput = {
  name: '',
  description: '',
  trigger: 'Shipment Order Created',
  warehouseId: null,
  clientId: null,
  match: 'All',
  conditions: [],
  actions: [],
  isActive: true,
  stopProcessing: false,
};

/** Short trigger label for the grid ("Shipment Order Created" → "Order created"); the full name stays in the tooltip/filter. */
export function shortTriggerLabel(trigger: string): string {
  const m = /^(Shipment Order|Purchase Order|Order) (\w+)$/.exec(trigger);
  if (!m) return trigger;
  const noun = m[1] === 'Purchase Order' ? 'PO' : 'Order';
  return `${noun} ${(m[2] ?? '').toLowerCase()}`;
}

/** Compact scope label: "All WH · All clients", "MLT1 · Acme". */
export function shortScopeLabel(warehouseCode: string | null, clientName: string | null): string {
  return `${warehouseCode ?? 'All WH'} · ${clientName ?? 'All clients'}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Compact grid timestamp that fits a ~120px column: "11/09 11:46 PM" within the current
 * year, "11/09/2025" for older dates. `time` formats the clock part per user prefs.
 */
export function compactWhen(value: string | Date, time: (v: Date) => string, now: Date = new Date()): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const md = `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  return d.getFullYear() === now.getFullYear() ? `${md} ${time(d)}` : `${md}/${d.getFullYear()}`;
}
