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
import type { CustomFieldConfig } from './custom-field-types';
import type { FormField, FormSettings } from './form-types';
import type { OrgRole, ProjectAction } from './permissions';
import type { TemplatePayload } from './template-types';
import type { ViewConfig } from './view-config';

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
  readonly taskCount: number;
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
