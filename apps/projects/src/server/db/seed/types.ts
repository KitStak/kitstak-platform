/**
 * Declarative seed model. Each org's data lives in `data/<org>.ts` as plain objects; `builder.ts`
 * turns them into real rows through the domain layer (so numbering, ranks, activity,
 * notifications and automations behave exactly as in the app), then `backdate.ts` spreads the
 * timestamps over the past weeks so history, reports and the inbox look lived-in.
 *
 * Dates are day offsets from today (negative = past). People are short handles ("renata")
 * mapped to member emails per org. Comment text may mention people with `{handle}`.
 */
import type { AutomationAction, AutomationCondition, AutomationTrigger } from '@/lib/automation-types';
import type { CustomFieldType, GoalHealth, GoalProgressMode, KeyResultKind, Priority, ProjectHealth, ProjectRole, ProjectStatus, StatusCategory, ViewType } from '@/lib/constants';
import type { FormField, FormSettings } from '@/lib/form-types';
import type { ViewConfig } from '@/lib/view-config';

export type Handle = string;

/** A record in a sibling app, picked by something stable (name/code) with a fallback. */
export type LinkPick =
  | { readonly type: 'core_customer'; readonly code: string }
  | { readonly type: 'crm_item'; readonly deal: string; readonly fallbackStage?: string }
  | { readonly type: 'crm_account'; readonly account: string }
  | { readonly type: 'wms_order'; readonly code?: string; readonly client?: string; readonly nth?: number; readonly status?: string }
  | { readonly type: 'wms_work_order'; readonly code?: string; readonly client?: string; readonly nth?: number }
  | { readonly type: 'wms_receipt'; readonly code?: string; readonly client?: string; readonly nth?: number }
  | { readonly type: 'wms_count'; readonly code?: string; readonly nth?: number };

/** [author, text, daysAgo?]. Text may contain `{handle}` mentions. */
export type CommentSeed = readonly [Handle, string] | readonly [Handle, string, { readonly reply?: boolean; readonly react?: readonly [Handle, string][] }];

/** [person, minutes, daysAgo, note?, billable?] */
export type TimeSeed = readonly [Handle, number, number, string?, boolean?];

export interface SubtaskSeed {
  readonly t: string;
  readonly a?: Handle | null;
  readonly done?: boolean;
  readonly due?: number;
}

export interface TaskSeed {
  /** Local reference for dependencies (`deps`). */
  readonly id?: string;
  readonly t: string;
  /** Description HTML. */
  readonly d?: string;
  /** Section name. */
  readonly s?: string;
  /** Status name (must exist in the project workflow). */
  readonly st: string;
  readonly a?: Handle | null;
  /** Who created it (default: project owner). */
  readonly by?: Handle;
  readonly p?: Priority;
  readonly start?: number;
  readonly due?: number;
  readonly pts?: number;
  /** Estimate in minutes. */
  readonly est?: number;
  readonly labels?: readonly string[];
  readonly sub?: readonly SubtaskSeed[];
  readonly c?: readonly CommentSeed[];
  /** Local ids of tasks that block this one. */
  readonly deps?: readonly string[];
  /** Diamond milestone on the timeline. */
  readonly ms?: boolean;
  /** Milestone (pm.milestones) name this task counts toward. */
  readonly milestone?: string;
  readonly time?: readonly TimeSeed[];
  readonly links?: readonly LinkPick[];
  /** Custom field values by field name (select: option label, person: handle). */
  readonly cf?: Readonly<Record<string, unknown>>;
  readonly watchers?: readonly Handle[];
  /** Days ago the task was created (default derived from dates). */
  readonly created?: number;
}

export interface CustomFieldSeed {
  readonly name: string;
  readonly type: CustomFieldType;
  readonly options?: readonly { readonly label: string; readonly color: string }[];
  readonly currency?: string;
  readonly description?: string;
}

export interface ProjectUpdateSeed {
  readonly by: Handle;
  readonly daysAgo: number;
  readonly health: ProjectHealth;
  readonly note: string;
  readonly status?: ProjectStatus;
}

export interface ViewSeed {
  readonly name: string;
  readonly type: ViewType;
  readonly config: ViewConfig;
  /** Owner of a personal view (default: shared with the project). */
  readonly personal?: Handle;
  readonly isDefault?: boolean;
}

export interface FileSeed {
  readonly name: string;
  readonly contentType: string;
  readonly body: string;
  readonly by: Handle;
  /** Task title it belongs to (else the project). */
  readonly task?: string;
  readonly daysAgo: number;
}

export interface ProjectSeed {
  readonly key: string;
  readonly name: string;
  readonly space: string;
  readonly owner: Handle;
  readonly members: readonly (readonly [Handle, ProjectRole])[];
  readonly color: string;
  readonly icon: string;
  readonly description: string;
  readonly status: ProjectStatus;
  readonly health: ProjectHealth;
  readonly start: number;
  readonly due: number;
  /** Days ago the project was set up (default: a few days before start). */
  readonly created?: number;
  /** Custom workflow (default: To do / In progress / In review / Done). */
  readonly workflow?: readonly { readonly name: string; readonly category: StatusCategory; readonly color: string; readonly wip?: number }[];
  readonly sections: readonly string[];
  readonly labels: readonly { readonly name: string; readonly color: string }[];
  readonly fields?: readonly CustomFieldSeed[];
  readonly milestones?: readonly { readonly name: string; readonly due: number; readonly description?: string; readonly done?: boolean }[];
  /** core.customers code; also stored as crm_customer_id. */
  readonly customer?: string;
  /** WMS client code for wms_ref. */
  readonly wmsClient?: string;
  /** Project-level links to CRM/WMS/customer records. */
  readonly links?: readonly LinkPick[];
  readonly updates?: readonly ProjectUpdateSeed[];
  readonly views?: readonly ViewSeed[];
  readonly files?: readonly FileSeed[];
  readonly tasks: readonly TaskSeed[];
}

export interface GoalSeed {
  readonly name: string;
  readonly description: string;
  readonly owner: Handle;
  readonly period: string;
  readonly start: number;
  readonly due: number;
  readonly health: GoalHealth;
  readonly color: string;
  readonly mode: GoalProgressMode;
  readonly manualProgress?: number;
  /** Project keys contributing (mode = projects, or just linked). */
  readonly projects?: readonly string[];
  readonly keyResults?: readonly {
    readonly name: string;
    readonly kind: KeyResultKind;
    readonly start?: number;
    readonly target?: number;
    readonly current?: number;
    readonly unit?: string;
    readonly project?: string;
  }[];
  /** Check-ins, oldest first: KR values by KR name. */
  readonly checkIns?: readonly { readonly by: Handle; readonly daysAgo: number; readonly health: GoalHealth; readonly note: string; readonly values?: Readonly<Record<string, number>> }[];
  /** Sub-goal of another goal (by name). */
  readonly parent?: string;
}

/** Resolves names in a project to ids when building automations/forms. */
export interface ProjectRefs {
  readonly id: string;
  readonly key: string;
  status(name: string): string;
  section(name: string): string;
  label(name: string): string;
}

export interface Refs {
  person(handle: Handle): string;
  project(key: string): ProjectRefs;
}

export interface AutomationSeed {
  readonly by: Handle;
  /** Project key (null = every project). */
  readonly project: string | null;
  readonly name: string;
  readonly description?: string;
  readonly enabled?: boolean;
  /** Created before the tasks, so it fires while the seed runs (realistic run history). */
  readonly early?: boolean;
  readonly build: (refs: Refs) => {
    readonly trigger: AutomationTrigger;
    readonly conditions?: readonly AutomationCondition[];
    readonly actions: readonly AutomationAction[];
  };
}

export interface FormSeed {
  readonly by: Handle;
  readonly project: string;
  readonly name: string;
  readonly description: string;
  readonly fields: readonly FormField[];
  readonly settings: (refs: Refs) => FormSettings;
  /** Public submissions: answers by field id. */
  readonly submissions: readonly { readonly name: string; readonly email: string; readonly answers: Readonly<Record<string, unknown>>; readonly daysAgo: number }[];
}

export interface TemplateSeed {
  readonly by: Handle;
  readonly fromProject: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
}

export interface OrgSeed {
  readonly slug: string;
  /** Handle → member email. */
  readonly people: Readonly<Record<Handle, string>>;
  /** The demo login whose Home/Inbox should look lived-in. */
  readonly me: Handle;
  readonly spaces: readonly { readonly name: string; readonly color: string; readonly icon: string; readonly description: string; readonly by: Handle }[];
  /** Workspace-wide labels (every project). */
  readonly workspaceLabels?: readonly { readonly name: string; readonly color: string }[];
  readonly projects: readonly ProjectSeed[];
  readonly goals: readonly GoalSeed[];
  readonly automations: readonly AutomationSeed[];
  readonly forms: readonly FormSeed[];
  readonly templates: readonly TemplateSeed[];
  /** Starred projects per person (sidebar). */
  readonly favorites: Readonly<Record<Handle, readonly string[]>>;
  /** Recently opened projects for `me`, most recent last. */
  readonly recents: readonly string[];
  /** Tasks `me` is running a timer on right now (key-less: project key + title). */
  readonly runningTimer?: { readonly project: string; readonly task: string; readonly minutesAgo: number };
}
