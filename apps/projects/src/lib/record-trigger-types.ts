/**
 * Cross-app triggers ("recipes"): workspace rules that watch CRM and WMS records and start work in
 * Projects. Pure types + the plain-language catalogue the builder renders. Server side:
 * src/server/integrations/record-triggers.ts. Table: pm.record_triggers (drizzle/0003).
 */
import type { Priority } from './constants';

export type RecordTriggerKind = 'crm_deal_won' | 'wms_receipt_discrepancy' | 'wms_count_variance';

export interface CrmDealWonConfig {
  /** Template to create the project from (`builtin:client-onboarding` or an org template id). */
  readonly templateId: string;
  /** Project owner (default: whoever set up the recipe). */
  readonly ownerId?: string | null;
  readonly spaceId?: string | null;
}

export interface WmsTaskConfig {
  /** Project the new task goes into. */
  readonly projectId: string;
  /** Who gets it (the receiving lead / inventory lead). Null = unassigned. */
  readonly assigneeId?: string | null;
  readonly priority?: Priority;
  /** Due this many days after it is created. */
  readonly dueInDays?: number;
  /** wms_count_variance only: fire when the count is off by more than this many percent. */
  readonly thresholdPercent?: number;
}

export type RecordTriggerConfig = CrmDealWonConfig | WmsTaskConfig;

export interface RecordTriggerRunDTO {
  readonly id: string;
  readonly triggerId: string;
  readonly recordType: string;
  readonly recordId: string;
  readonly recordTitle: string | null;
  readonly status: 'created' | 'skipped' | 'failed';
  readonly message: string;
  readonly resultUrl: string | null;
  readonly createdAt: string;
}

export interface RecordTriggerDTO {
  readonly id: string;
  readonly kind: RecordTriggerKind;
  readonly name: string;
  readonly config: RecordTriggerConfig;
  readonly enabled: boolean;
  /** Records changed after this moment are considered. */
  readonly since: string;
  readonly lastCheckedAt: string | null;
  readonly createdAt: string;
  /** Plain sentence: "When a CRM deal is won, create a project from Client onboarding". */
  readonly sentence: string;
  readonly runCount: number;
  readonly recentRuns: readonly RecordTriggerRunDTO[];
}

export interface RecordTriggerRecipe {
  readonly kind: RecordTriggerKind;
  readonly app: 'crm' | 'wms';
  readonly title: string;
  readonly description: string;
  readonly defaultName: string;
}

/** The library shown on the Automations page. */
export const RECORD_TRIGGER_RECIPES: readonly RecordTriggerRecipe[] = [
  {
    kind: 'crm_deal_won',
    app: 'crm',
    title: 'Deal won, start the project',
    description: 'When a CRM deal moves to Won, create a project from a template, linked to the deal and its customer.',
    defaultName: 'Start a project when a deal is won',
  },
  {
    kind: 'wms_receipt_discrepancy',
    app: 'wms',
    title: 'Receipt discrepancy, urgent task',
    description: 'When a WMS receipt comes in short, over or damaged, create an urgent task for the receiving lead.',
    defaultName: 'Chase receipt discrepancies',
  },
  {
    kind: 'wms_count_variance',
    app: 'wms',
    title: 'Count variance, open a task',
    description: 'When a cycle count is off by more than the limit you set, open a task to investigate.',
    defaultName: 'Investigate cycle count variance',
  },
];

export const RECORD_TRIGGER_APP: Readonly<Record<RecordTriggerKind, 'crm' | 'wms'>> = {
  crm_deal_won: 'crm',
  wms_receipt_discrepancy: 'wms',
  wms_count_variance: 'wms',
};

/** Plain-language sentence for a recipe (names resolved by the caller). */
export function describeRecordTrigger(
  kind: RecordTriggerKind,
  config: RecordTriggerConfig,
  names: { readonly template?: string | null; readonly project?: string | null; readonly person?: string | null } = {},
): string {
  const who = names.person ? ` for ${names.person}` : '';
  switch (kind) {
    case 'crm_deal_won':
      return `When a CRM deal is won, create a project from ${names.template ?? 'a template'}`;
    case 'wms_receipt_discrepancy': {
      const priority = (config as WmsTaskConfig).priority ?? 'urgent';
      return `When a WMS receipt has discrepancies, create ${priority === 'urgent' ? 'an urgent' : `a ${priority} priority`} task${who} in ${names.project ?? 'a project'}`;
    }
    case 'wms_count_variance': {
      const threshold = (config as WmsTaskConfig).thresholdPercent ?? 2;
      return `When a cycle count variance is over ${threshold}%, open a task${who} in ${names.project ?? 'a project'}`;
    }
  }
}
