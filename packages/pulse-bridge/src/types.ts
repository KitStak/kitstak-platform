/**
 * Plain JSON shapes the bridge returns. Safe to import from client components
 * (`@kitstak/pulse-bridge/types`): no server code is reachable from this file.
 *
 * Money is whole cents as a JS number (always a safe integer), margins are basis points
 * (3150 means 31.5%), quantities and hours are decimal strings. A money field the reader may
 * not see is `null` and the result carries `moneyHidden: true`.
 */

/** The five words Pulse uses for a job's health, worst first. One list for all five apps. */
export const PULSE_STATUSES = ['losing', 'at_risk', 'heads_up', 'on_track', 'no_data'] as const;
export type PulseStatus = (typeof PULSE_STATUSES)[number];

export const PULSE_STATUS_LABELS: Readonly<Record<PulseStatus, string>> = {
  losing: 'Losing money',
  at_risk: 'At risk',
  heads_up: 'Heads up',
  on_track: 'On track',
  no_data: 'Not enough data',
};

export function isPulseStatus(value: unknown): value is PulseStatus {
  return typeof value === 'string' && (PULSE_STATUSES as readonly string[]).includes(value);
}

export const PULSE_JOB_STATUS_LABELS: Readonly<Record<string, string>> = {
  planned: 'Planned',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Pulse roles, most to least powerful. `none` means the person has no access to Pulse. */
export const PULSE_ROLES = ['owner', 'admin', 'manager', 'supervisor', 'viewer', 'none'] as const;
export type PulseRole = (typeof PULSE_ROLES)[number];

export interface PulseAccess {
  readonly role: PulseRole;
  /** Revenue, cost, profit and margin fields are filled in for this person. */
  readonly seesMoney: boolean;
  readonly seesWages: boolean;
  /** Which step decided the role: an explicit Pulse role, the warehouse role, or the workspace role. */
  readonly source: 'explicit' | 'wms' | 'org';
  /** May type production into the daily log. */
  readonly canLog: boolean;
  /** May create and change jobs. */
  readonly canManageJobs: boolean;
}

/** Who is asking. Every read is answered for this person in this organization. */
export interface PulseReader {
  readonly orgId: string;
  readonly userId: string;
}

export type PulseUnavailableReason = 'not_installed' | 'no_access';

export interface PulseUnavailable {
  readonly available: false;
  readonly reason: PulseUnavailableReason;
}

/** Record types a sibling app can ask about. */
export const PULSE_RECORD_TYPES = [
  'crm_deal',
  'crm_account',
  'wms_work_order',
  'wms_shipment_order',
  'wms_client',
  'core_customer',
  'pm_project',
  'pm_task',
] as const;
export type PulseRecordType = (typeof PULSE_RECORD_TYPES)[number];

export interface PulseJobSummary {
  readonly id: string;
  /** The job number people say out loud, such as J-1042. */
  readonly number: string;
  readonly name: string;
  readonly clientId: string | null;
  readonly clientName: string | null;
  /** planned, active, on_hold, completed or cancelled. */
  readonly status: string;
  readonly statusLabel: string;
  /** Health of the job. `null` until Pulse has worked it out. */
  readonly risk: PulseStatus | null;
  readonly riskLabel: string | null;
  readonly unitLabel: string;
  readonly plannedUnits: string;
  readonly unitsGood: string;
  /** How far along, in basis points of the planned units. */
  readonly pctCompleteBp: number | null;
  readonly hours: string;
  readonly lastEntryDate: string | null;
  readonly dueDate: string | null;
  readonly revenueCents: number | null;
  readonly costCents: number | null;
  readonly laborCents: number | null;
  readonly materialCents: number | null;
  readonly profitCents: number | null;
  readonly marginBp: number | null;
  readonly targetMarginBp: number | null;
  readonly projectedProfitCents: number | null;
  readonly projectedMarginBp: number | null;
  /** Revenue the quote promised, when the job has a quote. */
  readonly quoteRevenueCents: number | null;
  /** Labor and material the plan allowed (the budget, else the quote). */
  readonly planLaborCents: number | null;
  readonly planMaterialCents: number | null;
  /** Path inside Pulse, such as /jobs/J-1042. The host adds the Pulse origin. */
  readonly path: string;
}

export interface PulseJobTotals {
  readonly jobs: number;
  readonly atRisk: number;
  readonly losing: number;
  readonly revenueCents: number | null;
  readonly costCents: number | null;
  readonly profitCents: number | null;
  readonly marginBp: number | null;
}

export interface PulseJobsForRecord {
  readonly available: true;
  readonly moneyHidden: boolean;
  readonly access: PulseAccess;
  readonly jobs: readonly PulseJobSummary[];
  readonly totals: PulseJobTotals;
}

export type PulseJobsResult = PulseJobsForRecord | PulseUnavailable;

export interface PulseClientRef {
  readonly pulseClientId?: string | null;
  readonly coreCustomerId?: string | null;
  readonly crmAccountItemId?: string | null;
}

export interface PulsePeriodProfit {
  readonly from: string;
  readonly to: string;
  readonly revenueCents: number | null;
  readonly costCents: number | null;
  readonly profitCents: number | null;
  readonly marginBp: number | null;
  readonly unitsGood: string;
  readonly hours: string;
}

export interface PulseMonthPoint {
  /** First day of the month, YYYY-MM-DD. */
  readonly month: string;
  readonly revenueCents: number | null;
  readonly profitCents: number | null;
  readonly marginBp: number | null;
}

export interface PulseClientProfit {
  readonly available: true;
  readonly moneyHidden: boolean;
  readonly access: PulseAccess;
  /** `null` when Pulse has no client for this record yet. */
  readonly client: { readonly id: string; readonly name: string; readonly targetMarginBp: number | null; readonly path: string } | null;
  readonly period: PulsePeriodProfit;
  /** A longer window for context (12 months by default), when asked for. */
  readonly longPeriod: PulsePeriodProfit | null;
  readonly trend: readonly PulseMonthPoint[];
  readonly openJobs: number;
  readonly atRisk: number;
  readonly losing: number;
  /** Open jobs, worst first. */
  readonly jobs: readonly PulseJobSummary[];
}

export type PulseClientProfitResult = PulseClientProfit | PulseUnavailable;

export interface PulseOrgSummary {
  readonly available: true;
  readonly moneyHidden: boolean;
  readonly access: PulseAccess;
  readonly from: string;
  readonly to: string;
  /** Jobs that are active or on hold. */
  readonly openJobs: number;
  readonly atRisk: number;
  readonly losing: number;
  /** Live jobs of any status. Zero means the workspace has not started with Pulse. */
  readonly totalJobs: number;
  readonly revenueCents: number | null;
  readonly costCents: number | null;
  readonly profitCents: number | null;
  readonly marginBp: number | null;
}

export type PulseOrgSummaryResult = PulseOrgSummary | PulseUnavailable;

export const BRIDGE_EVENT_KINDS = ['wms_work_order_changed', 'crm_deal_stage_changed', 'pm_time_logged'] as const;
export type BridgeEventKind = (typeof BRIDGE_EVENT_KINDS)[number];

export interface BridgeEventInput {
  readonly kind: BridgeEventKind;
  /** The id of the record that changed (work order id, deal item id, project id). */
  readonly targetId: string;
  readonly payload?: Readonly<Record<string, string | number | boolean | null>>;
}
