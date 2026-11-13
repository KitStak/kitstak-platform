/**
 * Public DTOs of the Projects bridge. Plain JSON (strings, numbers, booleans) so CRM / WMS can
 * return them straight from their API routes.
 */

/** Record kinds in the sibling apps that tasks and projects can link to (pm.integration_links). */
export const BRIDGE_TARGET_TYPES = [
  'crm_item',
  'crm_account',
  'core_customer',
  'wms_order',
  'wms_work_order',
  'wms_receipt',
  'wms_count',
] as const;
export type BridgeTargetType = (typeof BRIDGE_TARGET_TYPES)[number];

export const BRIDGE_SOURCES = ['crm', 'wms', 'portal'] as const;
export type BridgeSource = (typeof BRIDGE_SOURCES)[number];

export type BridgePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type BridgeStatusCategory = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type BridgeHealth = 'on_track' | 'at_risk' | 'off_track';
export type BridgeProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'archived';

export interface BridgeTarget {
  readonly type: BridgeTargetType;
  readonly id: string;
}

/** Who is acting. `userId` must be a member of `orgId` (checked against core.member). */
export interface BridgeActor {
  readonly orgId: string;
  readonly userId: string;
}

/** Where the Projects app lives (deep links). e.g. `https://projects.kitstak.app`. */
export interface BridgeUrls {
  readonly projectsUrl: string;
}

export interface BridgePerson {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
}

export interface BridgeProgress {
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
  /** 0–100. */
  readonly percent: number;
}

export interface BridgeProject {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly status: BridgeProjectStatus;
  readonly health: BridgeHealth;
  readonly color: string;
  readonly icon: string;
  readonly dueDate: string | null;
  readonly owner: BridgePerson | null;
  readonly progress: BridgeProgress;
  readonly archived: boolean;
  /** Link row id when the project is linked through pm.integration_links (null = via the project's own CRM/customer field). */
  readonly linkId: string | null;
  readonly url: string;
}

export interface BridgeTask {
  readonly id: string;
  /** `OPS-42`. */
  readonly key: string;
  readonly number: number;
  readonly title: string;
  readonly projectId: string;
  readonly projectKey: string;
  readonly projectName: string;
  readonly projectColor: string;
  readonly status: { readonly id: string; readonly name: string; readonly category: BridgeStatusCategory; readonly color: string };
  readonly priority: BridgePriority;
  readonly assignee: BridgePerson | null;
  readonly dueDate: string | null;
  readonly done: boolean;
  readonly overdue: boolean;
  readonly linkId: string;
  readonly url: string;
}

export interface LinkedWork {
  readonly projects: readonly BridgeProject[];
  readonly tasks: readonly BridgeTask[];
  /** Open tasks (not done/cancelled) among `tasks`. */
  readonly openTasks: number;
}

/** A project the actor may add tasks to (pickers). */
export interface WritableProject {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly color: string;
  readonly icon: string;
  readonly spaceName: string | null;
  readonly statuses: readonly { readonly id: string; readonly name: string; readonly category: BridgeStatusCategory; readonly color: string }[];
}

export interface CreateExternalTaskInput {
  readonly projectId: string;
  readonly title: string;
  /** Plain text; stored as a sanitized paragraph list. */
  readonly description?: string | null;
  readonly statusId?: string | null;
  readonly priority?: BridgePriority;
  readonly assigneeId?: string | null;
  /** `YYYY-MM-DD`. */
  readonly dueDate?: string | null;
  readonly startDate?: string | null;
  /** The record the task is about; a task-level link is created and its title/status cached. */
  readonly link: BridgeLinkSnapshot;
  readonly source: BridgeSource;
}

/** What the caller already knows about the record (cached on the link so chips render fast). */
export interface BridgeLinkSnapshot extends BridgeTarget {
  readonly title: string;
  readonly status?: string | null;
  readonly url?: string | null;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface CreatedExternalTask {
  readonly task: BridgeTask;
  readonly linkId: string;
}

export interface RecordStatusEvent {
  readonly orgId: string;
  readonly source: BridgeSource;
  readonly target: BridgeTarget;
  /** Current human title of the record (refreshes cached link titles). */
  readonly title?: string | null;
  /** New status/stage label ("Proposal", "Shipped"). */
  readonly status: string | null;
  /** Previous label when the caller knows it (otherwise taken from the cached link). */
  readonly previousStatus?: string | null;
  readonly url?: string | null;
  readonly actorId?: string | null;
}

export interface BridgeAvailability {
  /** The pm schema exists in this database. */
  readonly installed: boolean;
  /** pm.integration_events exists (automation hooks). */
  readonly events: boolean;
}
