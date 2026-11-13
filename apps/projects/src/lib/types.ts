/**
 * Client-facing DTOs returned by the domain layer (src/server/domain), server actions and the
 * /api/v1 route handlers. JSON-safe: timestamps are ISO strings, dates are `YYYY-MM-DD`.
 * Pure types; import from anywhere.
 */
import type {
  ActorKind,
  CustomFieldType,
  GoalHealth,
  GoalProgressMode,
  IntegrationTargetType,
  KeyResultKind,
  NotificationKind,
  Priority,
  ProjectHealth,
  ProjectRole,
  ProjectStatus,
  ProjectVisibility,
  StatusCategory,
  TimeEntrySource,
  ViewType,
} from './constants';
import type { AutomationAction, AutomationCondition, AutomationTrigger } from './automation-types';
import type { CycleReport } from './cycle-math';
import type { CustomFieldConfig } from './custom-field-types';
import type { FormField, FormSettings } from './form-types';
import type { OrgRole, ProjectAction } from './permissions';
import type { TemplatePayload } from './template-types';
import type { ViewConfig } from './view-config';
import type { ReportData } from './report-math';

/** ISO-8601 timestamp string. */
export type IsoDateTime = string;
/** Calendar date `YYYY-MM-DD`. */
export type IsoDate = string;

export interface PersonRef {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
}

/** An org member (people pickers, @mentions, assignees). */
export interface OrgPerson extends PersonRef {
  readonly orgRole: OrgRole;
  readonly title: string | null;
}

export interface SpaceDTO {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly color: string;
  readonly icon: string;
  readonly position: string;
  readonly isPrivate: boolean;
  readonly archivedAt: IsoDateTime | null;
  readonly projectCount: number;
}

export interface StatusDTO {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly category: StatusCategory;
  readonly color: string;
  readonly position: string;
  readonly wipLimit: number | null;
  readonly isDefault: boolean;
}

export interface SectionDTO {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly position: string;
}

export interface LabelDTO {
  readonly id: string;
  /** null = workspace-wide label. */
  readonly projectId: string | null;
  readonly name: string;
  readonly color: string;
}

export interface MilestoneDTO {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string | null;
  readonly dueDate: IsoDate | null;
  readonly completedAt: IsoDateTime | null;
  readonly position: string;
  readonly taskCount: number;
  readonly doneCount: number;
}

export interface CustomFieldDTO {
  readonly id: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly type: CustomFieldType;
  readonly config: CustomFieldConfig;
  readonly description: string | null;
  readonly required: boolean;
  readonly position: string;
}

export interface ProjectMemberDTO {
  readonly userId: string;
  readonly role: ProjectRole;
  readonly person: PersonRef;
  readonly addedAt: IsoDateTime;
}

export interface ProjectProgress {
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
  /** 0-100. */
  readonly percent: number;
}

export interface ProjectSummary {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly health: ProjectHealth;
  readonly healthNote: string | null;
  readonly color: string;
  readonly icon: string;
  readonly spaceId: string | null;
  readonly ownerId: string | null;
  readonly startDate: IsoDate | null;
  readonly dueDate: IsoDate | null;
  readonly visibility: ProjectVisibility;
  readonly crmCustomerId: string | null;
  readonly crmItemId: string | null;
  readonly isTemplate: boolean;
  readonly archivedAt: IsoDateTime | null;
  readonly completedAt: IsoDateTime | null;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly progress: ProjectProgress;
  readonly memberCount: number;
  /** The viewer's effective role. */
  readonly role: ProjectRole;
  readonly starred: boolean;
}

export type Capabilities = Readonly<Record<ProjectAction, boolean>>;

export interface ProjectDetail extends ProjectSummary {
  readonly description: string | null;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly wmsRef: Readonly<Record<string, unknown>> | null;
  readonly statuses: readonly StatusDTO[];
  readonly sections: readonly SectionDTO[];
  readonly labels: readonly LabelDTO[];
  readonly customFields: readonly CustomFieldDTO[];
  readonly milestones: readonly MilestoneDTO[];
  readonly members: readonly ProjectMemberDTO[];
  readonly capabilities: Capabilities;
}

/** Compact pointer to a task (dependencies, parents, search results). */
export interface TaskRef {
  readonly id: string;
  readonly projectId: string;
  readonly projectKey: string;
  readonly number: number;
  /** `OPS-42`. */
  readonly key: string;
  readonly title: string;
  readonly statusId: string;
  readonly statusCategory: StatusCategory;
}

export interface TaskSummary extends TaskRef {
  readonly sectionId: string | null;
  readonly priority: Priority;
  readonly assigneeId: string | null;
  readonly reporterId: string | null;
  readonly startDate: IsoDate | null;
  readonly dueDate: IsoDate | null;
  readonly estimatePoints: number | null;
  readonly estimateMinutes: number | null;
  readonly parentTaskId: string | null;
  readonly position: string;
  readonly isMilestone: boolean;
  readonly milestoneId: string | null;
  readonly labelIds: readonly string[];
  readonly customFields: Readonly<Record<string, unknown>>;
  readonly completedAt: IsoDateTime | null;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly subtaskCount: number;
  readonly subtaskDoneCount: number;
  readonly commentCount: number;
  readonly attachmentCount: number;
  /** Open tasks blocking this one. */
  readonly blockedByCount: number;
  readonly blockingCount: number;
  readonly linkCount: number;
}

export interface TaskRecurrenceDTO {
  readonly frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  readonly interval: number;
  readonly weekdays?: readonly number[];
}

export interface DependencyDTO {
  readonly id: string;
  readonly kind: string;
  readonly lagDays: number;
  readonly task: TaskRef;
}

export interface TaskDetail extends TaskSummary {
  readonly description: string | null;
  readonly recurrence: TaskRecurrenceDTO | null;
  readonly createdBy: string | null;
  readonly parent: TaskRef | null;
  readonly subtasks: readonly TaskSummary[];
  /** Tasks this task waits on. */
  readonly blockedBy: readonly DependencyDTO[];
  /** Tasks waiting on this task. */
  readonly blocking: readonly DependencyDTO[];
  readonly watcherIds: readonly string[];
  readonly links: readonly IntegrationLinkDTO[];
  readonly timeTotalMinutes: number;
  /** The viewer's running timer on this task, if any. */
  readonly runningTimer: TimeEntryDTO | null;
  readonly capabilities: Capabilities;
}

export interface CommentDTO {
  readonly id: string;
  readonly taskId: string;
  readonly projectId: string;
  readonly parentCommentId: string | null;
  readonly authorId: string | null;
  readonly body: string;
  readonly mentions: readonly string[];
  readonly reactions: Readonly<Record<string, readonly string[]>>;
  readonly editedAt: IsoDateTime | null;
  readonly createdAt: IsoDateTime;
  readonly attachments: readonly AttachmentDTO[];
}

export interface AttachmentDTO {
  readonly id: string;
  readonly projectId: string;
  readonly taskId: string | null;
  readonly commentId: string | null;
  readonly name: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  /** Same-origin download/preview URL. */
  readonly url: string;
  readonly uploadedBy: string | null;
  readonly createdAt: IsoDateTime;
}

export interface ActivityDTO {
  readonly id: string;
  readonly projectId: string | null;
  readonly taskId: string | null;
  readonly actorId: string | null;
  readonly actorKind: ActorKind;
  readonly verb: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly field: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly createdAt: IsoDateTime;
}

export interface TimeEntryDTO {
  readonly id: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly userId: string;
  readonly startedAt: IsoDateTime;
  readonly endedAt: IsoDateTime | null;
  readonly durationMinutes: number | null;
  readonly note: string | null;
  readonly billable: boolean;
  readonly source: TimeEntrySource;
  /** Key and title of the task (only on the running timer, so the timer pill needs no extra fetch). */
  readonly task?: { readonly key: string; readonly title: string } | null;
}

export interface NotificationDTO {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly actorId: string | null;
  readonly projectId: string | null;
  readonly taskId: string | null;
  readonly commentId: string | null;
  readonly title: string;
  readonly body: string | null;
  readonly url: string | null;
  readonly readAt: IsoDateTime | null;
  readonly archivedAt: IsoDateTime | null;
  readonly createdAt: IsoDateTime;
}

export interface KeyResultDTO {
  readonly id: string;
  readonly goalId: string;
  readonly name: string;
  readonly kind: KeyResultKind;
  readonly startValue: number;
  readonly targetValue: number;
  readonly currentValue: number;
  readonly unit: string | null;
  readonly projectId: string | null;
  readonly position: string;
  /** 0-100. */
  readonly progress: number;
}

export interface GoalDTO {
  readonly id: string;
  readonly parentGoalId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly ownerId: string | null;
  readonly period: string | null;
  readonly startDate: IsoDate | null;
  readonly dueDate: IsoDate | null;
  readonly health: GoalHealth;
  readonly progressMode: GoalProgressMode;
  readonly manualProgress: number;
  readonly color: string;
  readonly position: string;
  readonly keyResults: readonly KeyResultDTO[];
  readonly projectIds: readonly string[];
  /** Rolled-up 0-100. */
  readonly progress: number;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface SavedViewDTO {
  readonly id: string;
  readonly projectId: string | null;
  /** null = shared with everyone on the project. */
  readonly userId: string | null;
  readonly name: string;
  readonly type: ViewType;
  readonly config: ViewConfig;
  readonly isDefault: boolean;
  readonly position: string;
}

export interface AutomationDTO {
  readonly id: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly enabled: boolean;
  readonly trigger: AutomationTrigger;
  readonly conditions: readonly AutomationCondition[];
  readonly actions: readonly AutomationAction[];
  readonly runCount: number;
  readonly lastRunAt: IsoDateTime | null;
  readonly createdBy: string | null;
  readonly createdAt: IsoDateTime;
}

export interface AutomationRunDTO {
  readonly id: string;
  readonly automationId: string;
  readonly taskId: string | null;
  readonly status: 'success' | 'skipped' | 'failed';
  readonly summary: string | null;
  readonly createdAt: IsoDateTime;
}

/** Run history row across rules (Automations → Run history). */
export interface AutomationRunRowDTO extends AutomationRunDTO {
  readonly automationName: string;
  readonly projectId: string | null;
  /** `OPS-42` (null when the task was deleted). */
  readonly taskKey: string | null;
  readonly taskTitle: string | null;
  /** What started it: task_created, status_changed, due_soon, crm_stage_changed, … */
  readonly event: string | null;
}

export interface TemplateDTO {
  /** Built-ins use `builtin:<slug>`; org templates use their uuid. */
  readonly id: string;
  readonly builtIn: boolean;
  readonly name: string;
  readonly description: string | null;
  readonly category: string;
  readonly icon: string;
  readonly color: string;
  readonly payload: TemplatePayload;
  readonly useCount: number;
  /** Top-level tasks (counted like the project header). */
  readonly taskCount: number;
  /** Subtasks at any depth, shown as "11 tasks + 3 subtasks". */
  readonly subtaskCount: number;
}

export interface IntegrationLinkDTO {
  readonly id: string;
  readonly projectId: string | null;
  readonly taskId: string | null;
  readonly targetType: IntegrationTargetType;
  readonly targetId: string;
  readonly title: string | null;
  readonly status: string | null;
  /** Absolute URL into the sibling app. */
  readonly url: string | null;
  readonly cachedAt: IsoDateTime | null;
  readonly meta: Readonly<Record<string, unknown>>;
}

/** One fact on a linked record's hover card ("Deal value: $310,000"). */
export interface RecordDetailFact {
  readonly label: string;
  readonly value: string;
  readonly tone?: 'success' | 'warning' | 'danger';
}

/** One line item on a linked record's hover card ("Dock leveler kit · 3 of 4 received"). */
export interface RecordDetailLine {
  readonly label: string;
  readonly sku: string | null;
  readonly value: string;
  readonly tone?: 'success' | 'warning' | 'danger';
}

/** Live detail of a linked CRM / WMS record (`GET /api/v1/integrations/record?type&id`). */
export interface RecordDetail {
  readonly type: IntegrationTargetType;
  readonly id: string;
  readonly app: 'crm' | 'wms';
  /** "WMS receipt", "CRM deal". */
  readonly kindLabel: string;
  readonly title: string;
  readonly status: string | null;
  readonly url: string;
  readonly facts: readonly RecordDetailFact[];
  readonly lines: readonly RecordDetailLine[];
  readonly linesLabel: string | null;
  readonly moreLines: number;
  readonly updatedAt: string | null;
  readonly checkedAt: IsoDateTime;
}

export interface FormDTO {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string | null;
  readonly fields: readonly FormField[];
  readonly settings: FormSettings;
  readonly isPublic: boolean;
  readonly enabled: boolean;
  readonly publicToken: string;
  readonly submissionCount: number;
  readonly createdAt: IsoDateTime;
}

/** One response to an intake form (Forms → Responses). */
export interface FormSubmissionDTO {
  readonly id: string;
  readonly taskId: string | null;
  readonly data: Readonly<Record<string, unknown>>;
  readonly submitterName: string | null;
  readonly submitterEmail: string | null;
  readonly createdAt: IsoDateTime;
  readonly taskKey: string | null;
  readonly taskTitle: string | null;
}

/** What the public /forms/[id] page needs (no internal ids beyond the form). */
export interface PublicFormDTO {
  readonly token: string;
  readonly name: string;
  readonly description: string | null;
  readonly fields: readonly FormField[];
  readonly collectContact: boolean;
  readonly confirmationMessage: string | null;
  readonly accentColor: string | null;
  readonly orgName: string;
  readonly projectName: string;
}

export interface DashboardDTO {
  readonly id: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly widgets: readonly {
    readonly id: string;
    readonly type: string;
    readonly title?: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly options?: Readonly<Record<string, unknown>>;
  }[];
  readonly filters: Readonly<Record<string, unknown>>;
  readonly position: string;
}

/** Result of the global search (command palette, /search). */
export interface SearchResults {
  readonly tasks: readonly (TaskRef & { readonly projectName: string; readonly assigneeId: string | null })[];
  readonly projects: readonly Pick<ProjectSummary, 'id' | 'key' | 'name' | 'color' | 'icon' | 'status'>[];
  readonly people: readonly OrgPerson[];
  readonly goals: readonly Pick<GoalDTO, 'id' | 'name' | 'health'>[];
}

/** A comment hit on the /search page (nav team). */
export interface CommentSearchHit {
  readonly id: string;
  readonly taskId: string;
  readonly taskKey: string;
  readonly taskTitle: string;
  readonly projectId: string;
  readonly projectKey: string;
  readonly projectName: string;
  readonly authorId: string | null;
  /** Plain-text snippet around the match (mention tokens shown as @Name). */
  readonly excerpt: string;
  readonly createdAt: IsoDateTime;
}

export type FullSearchType = 'all' | 'tasks' | 'projects' | 'comments' | 'people' | 'goals';

/** GET /api/v1/search/full — the /search results page (nav team). */
export interface FullSearchResults {
  readonly query: string;
  readonly tasks: readonly TaskSummary[];
  readonly projects: readonly ProjectSummary[];
  readonly comments: readonly CommentSearchHit[];
  readonly people: readonly OrgPerson[];
  readonly goals: readonly GoalDTO[];
  /** Total matches per type before the page limit. */
  readonly counts: Readonly<Record<Exclude<FullSearchType, 'all'>, number>>;
}

// --- Portfolio team: status updates, goal check-ins, reports ------------------------------

/** A posted project status update (health + note), kept in the activity log. */
export interface ProjectUpdateDTO {
  readonly id: string;
  readonly projectId: string;
  readonly authorId: string | null;
  readonly health: ProjectHealth;
  /** Project status at the time of the update (null when it didn't change). */
  readonly status: ProjectStatus | null;
  readonly note: string | null;
  /** Project completion percent when the update was posted. */
  readonly progress: number;
  readonly createdAt: IsoDateTime;
}

/** A goal check-in (health, note and new key result values), kept in the activity log. */
export interface GoalCheckInDTO {
  readonly id: string;
  readonly goalId: string;
  readonly authorId: string | null;
  readonly health: GoalHealth;
  readonly note: string | null;
  readonly progress: number;
  readonly keyResults: readonly { readonly id: string; readonly name: string; readonly before: number; readonly after: number; readonly unit: string | null }[];
  readonly createdAt: IsoDateTime;
}

/** GET /api/v1/reports?project=KEY|&space=&weeks= — portfolio or single-project report. */
export interface ReportDTO extends ReportData {
  readonly scope:
    | { readonly kind: 'portfolio'; readonly projectCount: number; readonly spaceId: string | null }
    | { readonly kind: 'project'; readonly projectId: string; readonly key: string; readonly name: string };
}

// --- Cycles and Triage (planning team; pm.cycles / pm.cycle_tasks / pm.triage_items) ---

export interface CycleDTO {
  readonly id: string;
  readonly projectId: string;
  readonly number: number;
  /** Custom name; the UI falls back to "Cycle N". */
  readonly name: string | null;
  readonly goal: string | null;
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
  readonly autoRollover: boolean;
  readonly completedAt: IsoDateTime | null;
  readonly state: 'upcoming' | 'current' | 'done';
  /** Tasks in the cycle now (or when it closed). */
  readonly taskCount: number;
  readonly doneCount: number;
  readonly points: number;
  readonly donePoints: number;
}

export interface CycleDetailDTO {
  readonly cycle: CycleDTO;
  /** Tasks in the cycle now (top-level); for a closed cycle, the tasks it ended with. */
  readonly tasks: readonly TaskSummary[];
  readonly report: CycleReport;
}

export interface CycleListDTO {
  readonly cycles: readonly CycleDTO[];
  readonly currentId: string | null;
  /** Open top-level tasks that are not in any cycle. */
  readonly backlogCount: number;
  /** taskId → cycleId for every task in an open cycle (chips in Board/List). */
  readonly taskCycle: Readonly<Record<string, string>>;
}

export type TriageState = 'pending' | 'snoozed' | 'accepted' | 'declined' | 'merged';
export type TriageSource = 'manual' | 'form' | 'crm' | 'wms' | 'portal' | 'api';

export interface TriageItemDTO {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string | null;
  readonly priority: Priority;
  readonly source: TriageSource;
  /** "Bug report form", "CRM: Acme renewal". */
  readonly sourceLabel: string | null;
  readonly formId: string | null;
  readonly linkType: string | null;
  readonly linkId: string | null;
  readonly requesterId: string | null;
  readonly requesterName: string | null;
  readonly requesterEmail: string | null;
  readonly state: TriageState;
  readonly snoozedUntil: IsoDate | null;
  readonly declineReason: string | null;
  /** The task it became (accepted) or was merged into. */
  readonly task: TaskRef | null;
  readonly decidedBy: string | null;
  readonly decidedAt: IsoDateTime | null;
  readonly createdAt: IsoDateTime;
}

export interface TriageQueueDTO {
  readonly items: readonly TriageItemDTO[];
  readonly counts: Readonly<Record<'pending' | 'snoozed' | 'decided', number>>;
}

// --- Home: cross-app customer pulse (GET /api/v1/integrations/customer-pulse) -----------------

export interface CustomerPulseRowDTO {
  readonly key: string;
  readonly customerName: string;
  readonly customerUrl: string | null;
  readonly projects: readonly { readonly id: string; readonly key: string; readonly name: string; readonly openTasks: number; readonly overdue: number }[];
  readonly deal: {
    readonly name: string;
    readonly stage: string | null;
    readonly outcome: 'won' | 'lost' | 'open';
    readonly closeDate: string | null;
    readonly amount: number | null;
    readonly currency: string | null;
    readonly url: string;
  } | null;
  readonly lateReceipts: number;
  readonly exceptions: number;
  readonly openOrders: number;
  readonly receiptsUrl: string | null;
  readonly exceptionsUrl: string | null;
  readonly risks: readonly { readonly id: string; readonly tone: 'danger' | 'warning'; readonly text: string; readonly href: string | null }[];
}

export interface CustomerMismatchDTO {
  readonly id: string;
  readonly kind: 'deal-closed-task-open' | 'deal-lost-project-open' | 'receipts-late';
  readonly tone: 'danger' | 'warning';
  readonly customer: string | null;
  readonly fact: string;
  readonly task: { readonly id: string; readonly ref: string; readonly title: string; readonly href: string } | null;
  readonly work: string;
  readonly projectHref: string;
  readonly dealUrl: string | null;
  readonly receiptsUrl: string | null;
  readonly text: string;
  readonly href: string;
}

export interface CustomerPulseDTO {
  readonly available: { readonly crm: boolean; readonly wms: boolean };
  readonly sources: { readonly deals: boolean; readonly warehouse: boolean };
  readonly rows: readonly CustomerPulseRowDTO[];
  readonly mismatches: readonly CustomerMismatchDTO[];
}
