'use client';
/**
 * Read hooks over /api/v1 (React Query). Every hook accepts optional `initialData` so server
 * components can render instantly and the client keeps it fresh (refetch on focus).
 */
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { apiGet, apiPath } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { IntegrationTargetType } from '@/lib/constants';
import type {
  ActivityDTO,
  AttachmentDTO,
  AutomationDTO,
  AutomationRunDTO,
  CommentDTO,
  CustomFieldDTO,
  CustomerPulseDTO,
  CycleDetailDTO,
  CycleListDTO,
  DashboardDTO,
  FormDTO,
  GoalCheckInDTO,
  GoalDTO,
  IntegrationLinkDTO,
  LabelDTO,
  NotificationDTO,
  OrgPerson,
  ProjectDetail,
  ProjectSummary,
  ProjectUpdateDTO,
  ReportDTO,
  SavedViewDTO,
  SearchResults,
  SpaceDTO,
  TaskDetail,
  TaskSummary,
  TemplateDTO,
  TimeEntryDTO,
  TriageQueueDTO,
} from '@/lib/types';
import type { OrgRole } from '@/lib/permissions';

type Opts<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, 'queryKey' | 'queryFn'>;

export interface MeResponse {
  readonly user: { id: string; name: string; email: string; image: string | null };
  readonly org: { id: string; name: string; slug: string; logo: string | null; role: OrgRole };
  readonly orgRole: OrgRole;
  readonly orgs: readonly { id: string; name: string; slug: string; logo: string | null; role: OrgRole }[];
  readonly unread: number;
  readonly modules: { crm: boolean; wms: boolean; projects: boolean };
  readonly integrations: { crm: boolean; wms: boolean };
  readonly runningTimer: TimeEntryDTO | null;
  readonly prefs: Record<string, unknown>;
}

export interface ActivityPage {
  readonly items: readonly ActivityDTO[];
  readonly nextCursor: string | null;
}

export interface InboxPage {
  readonly items: readonly NotificationDTO[];
  readonly nextCursor: string | null;
  readonly unread: number;
}

export interface DependencyRow {
  readonly id: string;
  readonly blockingTaskId: string;
  readonly blockedTaskId: string;
  readonly kind: string;
  readonly lagDays: number;
}

export interface ResolvedTargetDTO {
  readonly type: IntegrationTargetType;
  readonly id: string;
  readonly title: string;
  readonly status: string | null;
  readonly url: string | null;
  readonly meta?: Record<string, unknown>;
}

export interface LinkedWorkDTO {
  readonly target: { type: IntegrationTargetType; id: string };
  readonly projects: readonly ProjectSummary[];
  readonly tasks: readonly TaskSummary[];
}

export const useMe = (opts?: Opts<MeResponse>) =>
  useQuery({ queryKey: qk.me(), queryFn: () => apiGet<MeResponse>(apiPath('me')), staleTime: 30_000, ...opts });

export const usePeople = (opts?: Opts<OrgPerson[]>) =>
  useQuery({ queryKey: qk.people(), queryFn: () => apiGet<OrgPerson[]>(apiPath('people')), staleTime: 5 * 60_000, ...opts });

export const useSpaces = (opts?: Opts<SpaceDTO[]>) =>
  useQuery({ queryKey: qk.spaces(), queryFn: () => apiGet<SpaceDTO[]>(apiPath('spaces')), ...opts });

export const useProjects = (params: { space?: string; archived?: boolean; q?: string } = {}, opts?: Opts<ProjectSummary[]>) =>
  useQuery({
    queryKey: Object.keys(params).length ? qk.projects(params) : qk.projects(),
    queryFn: () => apiGet<ProjectSummary[]>(apiPath('projects', params)),
    ...opts,
  });

export const useProject = (key: string, opts?: Opts<ProjectDetail>) =>
  useQuery({ queryKey: qk.project(key), queryFn: () => apiGet<ProjectDetail>(apiPath(`projects/${encodeURIComponent(key)}`)), ...opts });

export const useProjectTasks = (key: string, opts?: Opts<TaskSummary[]>) =>
  useQuery({
    queryKey: qk.projectTasks(key),
    queryFn: () => apiGet<TaskSummary[]>(apiPath(`projects/${encodeURIComponent(key)}/tasks`)),
    ...opts,
  });

export const useProjectActivity = (key: string, opts?: Opts<ActivityPage>) =>
  useQuery({ queryKey: qk.projectActivity(key), queryFn: () => apiGet<ActivityPage>(apiPath(`projects/${encodeURIComponent(key)}/activity`)), ...opts });

export const useProjectFiles = (key: string, opts?: Opts<AttachmentDTO[]>) =>
  useQuery({ queryKey: qk.projectFiles(key), queryFn: () => apiGet<AttachmentDTO[]>(apiPath(`projects/${encodeURIComponent(key)}/files`)), ...opts });

export const useProjectViews = (key: string, opts?: Opts<SavedViewDTO[]>) =>
  useQuery({ queryKey: qk.projectViews(key), queryFn: () => apiGet<SavedViewDTO[]>(apiPath(`projects/${encodeURIComponent(key)}/views`)), ...opts });

export const useProjectDependencies = (key: string, opts?: Opts<DependencyRow[]>) =>
  useQuery({
    queryKey: qk.projectDependencies(key),
    queryFn: () => apiGet<DependencyRow[]>(apiPath(`projects/${encodeURIComponent(key)}/dependencies`)),
    ...opts,
  });

export const useProjectLinks = (key: string, opts?: Opts<IntegrationLinkDTO[]>) =>
  useQuery({ queryKey: qk.projectLinks(key), queryFn: () => apiGet<IntegrationLinkDTO[]>(apiPath(`projects/${encodeURIComponent(key)}/links`)), ...opts });

/** Task-level links for every task in the project (chips on board/list/table). */
export const useProjectTaskLinks = (key: string, opts?: Opts<IntegrationLinkDTO[]>) =>
  useQuery({
    queryKey: qk.projectTaskLinks(key),
    queryFn: () => apiGet<IntegrationLinkDTO[]>(apiPath(`projects/${encodeURIComponent(key)}/task-links`)),
    staleTime: 60_000,
    ...opts,
  });

export const useProjectGoals = (key: string, opts?: Opts<GoalDTO[]>) =>
  useQuery({ queryKey: qk.projectGoals(key), queryFn: () => apiGet<GoalDTO[]>(apiPath(`projects/${encodeURIComponent(key)}/goals`)), ...opts });

/** `idOrKey`: task uuid or `OPS-42`. */
export const useTask = (idOrKey: string | null | undefined, opts?: Opts<TaskDetail>) =>
  useQuery({
    queryKey: qk.task(idOrKey ?? ''),
    queryFn: () => apiGet<TaskDetail>(apiPath(`tasks/${encodeURIComponent(idOrKey ?? '')}`)),
    enabled: Boolean(idOrKey),
    ...opts,
  });

export const useTaskComments = (taskId: string | null | undefined, opts?: Opts<CommentDTO[]>) =>
  useQuery({
    queryKey: qk.taskComments(taskId ?? ''),
    queryFn: () => apiGet<CommentDTO[]>(apiPath(`tasks/${taskId}/comments`)),
    enabled: Boolean(taskId),
    ...opts,
  });

export const useTaskActivity = (taskId: string | null | undefined, opts?: Opts<ActivityPage>) =>
  useQuery({
    queryKey: qk.taskActivity(taskId ?? ''),
    queryFn: () => apiGet<ActivityPage>(apiPath(`tasks/${taskId}/activity`)),
    enabled: Boolean(taskId),
    ...opts,
  });

export const useTaskTime = (taskId: string | null | undefined, opts?: Opts<TimeEntryDTO[]>) =>
  useQuery({ queryKey: qk.taskTime(taskId ?? ''), queryFn: () => apiGet<TimeEntryDTO[]>(apiPath(`tasks/${taskId}/time`)), enabled: Boolean(taskId), ...opts });

export const useTaskAttachments = (taskId: string | null | undefined, opts?: Opts<AttachmentDTO[]>) =>
  useQuery({
    queryKey: qk.taskAttachments(taskId ?? ''),
    queryFn: () => apiGet<AttachmentDTO[]>(apiPath(`tasks/${taskId}/attachments`)),
    enabled: Boolean(taskId),
    ...opts,
  });

export const useMyTasks = (scope: 'assigned' | 'created' | 'watching' | 'all' = 'assigned', completed?: boolean, opts?: Opts<TaskSummary[]>) =>
  useQuery({ queryKey: qk.myTasks(scope, completed), queryFn: () => apiGet<TaskSummary[]>(apiPath('my-tasks', { scope, completed })), ...opts });

export const useNotifications = (filter: 'all' | 'unread' | 'archived' | 'mentions' | 'assigned' | 'comments' | 'due' = 'all', opts?: Opts<InboxPage>) =>
  useQuery({ queryKey: qk.notifications(filter), queryFn: () => apiGet<InboxPage>(apiPath('notifications', { filter })), ...opts });

/** Unread inbox count; polls every 20s (also in background tabs) so the sidebar badge feels live. */
export const useUnreadCount = (opts?: Opts<{ count: number }>) =>
  useQuery({
    queryKey: qk.unread(),
    queryFn: () => apiGet<{ count: number }>(apiPath('notifications/unread')),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
    ...opts,
  });

export const useSearch = (q: string, opts?: Opts<SearchResults>) =>
  useQuery({
    queryKey: qk.search(q),
    queryFn: () => apiGet<SearchResults>(apiPath('search', { q })),
    enabled: q.trim().length > 0,
    staleTime: 10_000,
    placeholderData: (previous) => previous,
    ...opts,
  });

export const useGoals = (opts?: Opts<GoalDTO[]>) => useQuery({ queryKey: qk.goals(), queryFn: () => apiGet<GoalDTO[]>(apiPath('goals')), ...opts });

export const useAutomations = (projectId?: string | null, opts?: Opts<AutomationDTO[]>) =>
  useQuery({ queryKey: qk.automations(projectId), queryFn: () => apiGet<AutomationDTO[]>(apiPath('automations', { projectId })), ...opts });

export const useAutomationRuns = (automationId: string | null, opts?: Opts<AutomationRunDTO[]>) =>
  useQuery({
    queryKey: qk.automationRuns(automationId ?? ''),
    queryFn: () => apiGet<AutomationRunDTO[]>(apiPath(`automations/${automationId}/runs`)),
    enabled: Boolean(automationId),
    ...opts,
  });

export const useTemplates = (opts?: Opts<TemplateDTO[]>) =>
  useQuery({ queryKey: qk.templates(), queryFn: () => apiGet<TemplateDTO[]>(apiPath('templates')), staleTime: 60_000, ...opts });

export const useDashboards = (projectId?: string | null, opts?: Opts<DashboardDTO[]>) =>
  useQuery({
    queryKey: qk.dashboards(projectId),
    queryFn: () => apiGet<DashboardDTO[]>(apiPath('dashboards', { projectId: projectId === null ? 'none' : projectId })),
    ...opts,
  });

export const useForms = (projectId?: string, opts?: Opts<FormDTO[]>) =>
  useQuery({ queryKey: qk.forms(projectId), queryFn: () => apiGet<FormDTO[]>(apiPath('forms', { projectId })), ...opts });

export const useLabels = (projectId?: string | null, opts?: Opts<LabelDTO[]>) =>
  useQuery({ queryKey: qk.labels(projectId), queryFn: () => apiGet<LabelDTO[]>(apiPath('labels', { projectId })), ...opts });

export const useCustomFields = (projectId?: string | null, opts?: Opts<CustomFieldDTO[]>) =>
  useQuery({ queryKey: qk.customFields(projectId), queryFn: () => apiGet<CustomFieldDTO[]>(apiPath('custom-fields', { projectId })), ...opts });

export const useRecents = (opts?: Opts<{ entityType: string; entityId: string; visitedAt: string }[]>) =>
  useQuery({ queryKey: qk.recents(), queryFn: () => apiGet<{ entityType: string; entityId: string; visitedAt: string }[]>(apiPath('recents')), ...opts });

export const useRunningTimer = (opts?: Opts<TimeEntryDTO | null>) =>
  useQuery({ queryKey: qk.runningTimer(), queryFn: () => apiGet<TimeEntryDTO | null>(apiPath('time/running')), ...opts });

export const useIntegrationStatus = (opts?: Opts<{ crm: boolean; wms: boolean; targetTypes: IntegrationTargetType[] }>) =>
  useQuery({
    queryKey: qk.integrationStatus(),
    queryFn: () => apiGet<{ crm: boolean; wms: boolean; targetTypes: IntegrationTargetType[] }>(apiPath('integrations/status')),
    staleTime: 5 * 60_000,
    ...opts,
  });

export const useIntegrationSearch = (type: IntegrationTargetType, q: string, opts?: Opts<ResolvedTargetDTO[]>) =>
  useQuery({
    queryKey: qk.integrationSearch(type, q),
    queryFn: () => apiGet<ResolvedTargetDTO[]>(apiPath('integrations/search', { type, q })),
    placeholderData: (previous) => previous,
    ...opts,
  });

export const useLinkedWork = (type: IntegrationTargetType, id: string, opts?: Opts<LinkedWorkDTO>) =>
  useQuery({ queryKey: qk.links(type, id), queryFn: () => apiGet<LinkedWorkDTO>(apiPath('links', { type, id })), ...opts });

// --- Portfolio team -------------------------------------------------------------------------

/** Status update history of a project (newest first). */
export const useProjectUpdates = (key: string, opts?: Opts<ProjectUpdateDTO[]>) =>
  useQuery({ queryKey: qk.projectUpdates(key), queryFn: () => apiGet<ProjectUpdateDTO[]>(apiPath(`projects/${encodeURIComponent(key)}/updates`)), ...opts });

export const useGoalCheckIns = (goalId: string | null, opts?: Opts<GoalCheckInDTO[]>) =>
  useQuery({
    queryKey: qk.goalCheckIns(goalId ?? ''),
    queryFn: () => apiGet<GoalCheckInDTO[]>(apiPath(`goals/${goalId}/check-ins`)),
    enabled: Boolean(goalId),
    ...opts,
  });

/** Portfolio report (no project) or one project's report. */
export const useReport = (scope: { project?: string; space?: string | null; weeks?: number }, opts?: Opts<ReportDTO>) =>
  useQuery({
    queryKey: qk.report(scope),
    queryFn: () => apiGet<ReportDTO>(apiPath('reports', { project: scope.project, space: scope.space ?? undefined, weeks: scope.weeks })),
    placeholderData: (previous) => previous,
    ...opts,
  });

// --- Planning team: cycles and triage -------------------------------------------------------

export const useCycles = (key: string, opts?: Opts<CycleListDTO>) =>
  useQuery({ queryKey: qk.cycles(key), queryFn: () => apiGet<CycleListDTO>(apiPath(`projects/${encodeURIComponent(key)}/cycles`)), ...opts });

export const useCycle = (id: string | null, opts?: Opts<CycleDetailDTO>) =>
  useQuery({ queryKey: qk.cycle(id ?? ''), queryFn: () => apiGet<CycleDetailDTO>(apiPath(`cycles/${id}`)), enabled: Boolean(id), ...opts });

export const useTriage = (key: string, filter: 'open' | 'snoozed' | 'decided' = 'open', opts?: Opts<TriageQueueDTO>) =>
  useQuery({ queryKey: qk.triage(key, filter), queryFn: () => apiGet<TriageQueueDTO>(apiPath(`projects/${encodeURIComponent(key)}/triage`, { filter })), ...opts });

/** Home "Your customers today" (CRM + WMS per customer, plus mismatches). Loads after first paint. */
export const useCustomerPulse = (opts?: Opts<CustomerPulseDTO>) =>
  useQuery({ queryKey: qk.customerPulse(), queryFn: () => apiGet<CustomerPulseDTO>(apiPath('integrations/customer-pulse')), staleTime: 60_000, ...opts });
