/**
 * Shapes shared by the integration readers (server) and the integration UI (client).
 * Pure types and words: safe to import anywhere.
 */
import type { LinkTargetType } from '@/lib/constants';

export type SiblingApp = 'crm' | 'wms' | 'projects';

export const SIBLING_APP_NAMES: Readonly<Record<SiblingApp, string>> = {
  crm: 'KitStak CRM',
  wms: 'KitStak WMS',
  projects: 'KitStak Projects',
};

export function appOfTarget(type: LinkTargetType): SiblingApp {
  return type.startsWith('crm_') ? 'crm' : type.startsWith('wms_') ? 'wms' : 'projects';
}

export const TARGET_WORDS: Readonly<Record<LinkTargetType, string>> = {
  crm_deal: 'CRM deal',
  crm_account: 'CRM account',
  wms_work_order: 'Work order',
  wms_shipment_order: 'Shipment order',
  wms_client: 'Warehouse client',
  pm_project: 'Project',
  pm_task: 'Project task',
  pm_program: 'Program',
  pm_build: 'Program build',
};

/** Record kinds a person can search for and link to a job. */
export const LINKABLE_TYPES = ['crm_deal', 'wms_work_order', 'pm_project'] as const;
export type LinkableType = (typeof LINKABLE_TYPES)[number];

export type RecordTone = 'good' | 'warn' | 'bad' | 'quiet' | 'info';

/** A sibling record as it is right now (not the copy stored on the link). */
export interface LiveRecordDTO {
  readonly type: LinkTargetType;
  readonly id: string;
  readonly app: SiblingApp;
  /** `live`: read just now. `gone`: the record was deleted. `offline`: the app cannot be read for this workspace. */
  readonly state: 'live' | 'gone' | 'offline';
  readonly title: string | null;
  readonly status: string | null;
  readonly tone: RecordTone;
  /** One more fact in plain words ("12 of 20 kits built"). */
  readonly detail: string | null;
  /** Full URL into the sibling app, or null. */
  readonly url: string | null;
}

/** One search hit in the link dialog. */
export interface RecordOptionDTO {
  readonly type: LinkableType;
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly status: string | null;
  readonly tone: RecordTone;
  /** Path inside the sibling app, stored on the link. */
  readonly path: string | null;
  /** The job already linked to this record, when there is one. */
  readonly linkedJobNumber: string | null;
}

export type ConnectionState = 'connected' | 'not_set_up' | 'not_on_plan';

export interface SyncRunDTO {
  readonly id: string;
  readonly source: SiblingApp;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly status: string;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly skippedClosed: number;
  readonly error: string | null;
  readonly trigger: string;
}

export interface AppConnectionDTO {
  readonly app: SiblingApp;
  readonly state: ConnectionState;
  /** Full URL of the sibling app. */
  readonly url: string;
  readonly lastSyncedAt: string | null;
  readonly lastStatus: string | null;
  readonly lastError: string | null;
  /** A sync is running right now. */
  readonly running: boolean;
  /** What the last good sync saw, as plain counts by name. */
  readonly counts: Readonly<Record<string, number>>;
  /** Jobs linked to a record of this app. */
  readonly linkedJobs: number;
  readonly lastRun: SyncRunDTO | null;
}

export interface ConnectedAppsDTO {
  readonly apps: readonly AppConnectionDTO[];
  /** This person may run a sync and change the switches. */
  readonly canManage: boolean;
  readonly switches: {
    readonly wmsSyncMaterials: boolean;
    readonly wmsSyncBilling: boolean;
    readonly wmsContractPrices: boolean;
    readonly crmSuggestJobs: boolean;
    readonly projectsTimeImport: boolean;
  };
}

export interface SyncResultDTO {
  readonly source: SiblingApp;
  /** `skipped`: another sync was already running, or the app is not connected. */
  readonly status: 'ok' | 'failed' | 'skipped';
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly skippedClosed: number;
  /** A plain sentence for the person. */
  readonly message: string;
}

export interface LinkedJobDTO {
  readonly linkId: string;
  readonly jobId: string;
  readonly jobNumber: string;
  readonly jobName: string;
  readonly targetType: LinkTargetType;
  readonly targetId: string;
  readonly importsTime: boolean;
  readonly title: string | null;
  readonly status: string | null;
  readonly path: string | null;
}
