'use client';
/**
 * Read hooks over /api/v1 (React Query), one per endpoint. Every hook accepts optional
 * `initialData` so server components can render instantly and the client keeps it fresh
 * (refetch on focus). Query keys live in `@/lib/query-keys`; invalidate by prefix after a write.
 */
import { keepPreviousData, useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { apiGet, apiGetPage, apiPath } from '@/lib/api-client';
import { collectPages, type AllRows, type PageMeta } from '@/lib/paging';
import type { AlertEntityType, AlertStatus, CostScope, DayReviewStatus, FactKind, JobStatusValue, JobTab, ProfitGroup, PulseStatus, SavedViewPage, StoredRevenueKind, StreamSource, TargetScope } from '@/lib/constants';
import { qk } from '@/lib/query-keys';
import type {
  ActivityDTO,
  AlertDTO,
  AlertRuleDTO,
  BadgesDTO,
  ClientDTO,
  CloseChecklistDTO,
  CompanyBridgeDTO,
  CostEntryDTO,
  DayReviewDTO,
  FactRowDTO,
  IndirectEntryDTO,
  ItemDTO,
  JobDetailDTO,
  DeletedJobDTO,
  JobListItemDTO,
  JobPlansDTO,
  JobPriceDTO,
  JobTypeDTO,
  LaborClassDTO,
  LaborRateDTO,
  LaborSummaryDTO,
  LogGridDTO,
  MaterialUsageDTO,
  MeResponse,
  MemberRoleDTO,
  NotificationDTO,
  OrgPerson,
  PaceSuggestionDTO,
  Page,
  PaidHoursDTO,
  PeriodDTO,
  PreviousCrewDTO,
  ProductionEntryDTO,
  ProfitResponse,
  RateForEntryDTO,
  RevenueEntryDTO,
  RunPulseDTO,
  SavedViewDTO,
  SearchHitDTO,
  SettingsDTO,
  SiteDTO,
  StandardDTO,
  SummaryDTO,
  TargetDTO,
  TrendPointDTO,
  UserPrefsDTO,
  VasEntryDTO,
  VasServiceDTO,
} from '@/lib/types';

export type Opts<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, 'queryKey' | 'queryFn'>;
type Query = Record<string, string | number | boolean | null | undefined>;

const SHORT = 15_000;
const MEDIUM = 60_000;
const LONG = 5 * 60_000;

const get = <T,>(path: string, params?: Query) => () => apiGet<T>(apiPath(path, params));
const list = (values?: readonly string[]): string | undefined => (values && values.length > 0 ? values.join(',') : undefined);

/* ---------------------------------------------------------------- who and where */

export const useMe = (opts?: Opts<MeResponse>) => useQuery({ queryKey: qk.me(), queryFn: get<MeResponse>('me'), staleTime: 30_000, ...opts });
export const usePeople = (opts?: Opts<OrgPerson[]>) => useQuery({ queryKey: qk.people(), queryFn: get<OrgPerson[]>('people'), staleTime: LONG, ...opts });
/** Sidebar and bell counts. Refreshes every minute. */
export const useBadges = (opts?: Opts<BadgesDTO>) => useQuery({ queryKey: qk.badges(), queryFn: get<BadgesDTO>('badges'), staleTime: SHORT, refetchInterval: 60_000, ...opts });
export const useSettings = (opts?: Opts<SettingsDTO>) => useQuery({ queryKey: qk.settings(), queryFn: get<SettingsDTO>('settings'), staleTime: MEDIUM, ...opts });
export const useSites = (opts?: Opts<SiteDTO[]>) => useQuery({ queryKey: qk.sites(), queryFn: get<SiteDTO[]>('sites'), staleTime: LONG, ...opts });
export const useMemberRoles = (opts?: Opts<MemberRoleDTO[]>) => useQuery({ queryKey: qk.roles(), queryFn: get<MemberRoleDTO[]>('roles'), staleTime: MEDIUM, ...opts });
export const useRunState = (opts?: Opts<RunPulseDTO>) => useQuery({ queryKey: qk.runState(), queryFn: get<RunPulseDTO>('roles/run-state'), staleTime: MEDIUM, ...opts });

/* ---------------------------------------------------------------- setup records */

export interface ClientListParams {
  q?: string | null;
  activeOnly?: boolean;
  includeDeleted?: boolean;
}
export const useClients = (params: ClientListParams = {}, opts?: Opts<ClientDTO[]>) =>
  useQuery({ queryKey: qk.clients(params as Query), queryFn: get<ClientDTO[]>('clients', { q: params.q, active: params.activeOnly, deleted: params.includeDeleted }), staleTime: MEDIUM, placeholderData: keepPreviousData, ...opts });
export const useClient = (id: string | null | undefined, opts?: Opts<ClientDTO>) => useQuery({ queryKey: qk.client(id ?? ''), queryFn: get<ClientDTO>(`clients/${id}`), enabled: Boolean(id), staleTime: MEDIUM, ...opts });
export const useClientByRef = (ref: { client?: string | null; coreCustomerId?: string | null; crmAccountItemId?: string | null }, opts?: Opts<ClientDTO | null>) =>
  useQuery({ queryKey: qk.clientByRef(ref), queryFn: get<ClientDTO | null>('clients/by-ref', ref), enabled: Boolean(ref.client || ref.coreCustomerId || ref.crmAccountItemId), staleTime: MEDIUM, ...opts });
export const useJobTypes = (params: { includeArchived?: boolean } = {}, opts?: Opts<JobTypeDTO[]>) =>
  useQuery({ queryKey: qk.jobTypes(params), queryFn: get<JobTypeDTO[]>('job-types', { archived: params.includeArchived }), staleTime: LONG, ...opts });
export const useLaborClasses = (params: { includeArchived?: boolean } = {}, opts?: Opts<LaborClassDTO[]>) =>
  useQuery({ queryKey: qk.laborClasses(params), queryFn: get<LaborClassDTO[]>('labor-classes', { archived: params.includeArchived }), staleTime: MEDIUM, ...opts });
/** Dated rate rows. The server answers 403 for readers who may not see money. */
export const useLaborRates = (params: { laborClassId?: string | null } = {}, opts?: Opts<LaborRateDTO[]>) =>
  useQuery({ queryKey: qk.laborRates(params), queryFn: get<LaborRateDTO[]>('labor-rates', { laborClass: params.laborClassId }), staleTime: MEDIUM, retry: false, ...opts });
export const useRateForEntry = (params: { laborClassId?: string | null; siteId?: string | null; date?: string | null }, opts?: Opts<RateForEntryDTO>) =>
  useQuery({ queryKey: qk.rateForEntry(params), queryFn: get<RateForEntryDTO>('labor-rates/for-entry', { laborClass: params.laborClassId, site: params.siteId, date: params.date }), staleTime: MEDIUM, ...opts });
export const useItems = (params: { q?: string | null; clientId?: string | null; limit?: number } = {}, opts?: Opts<ItemDTO[]>) =>
  useQuery({ queryKey: qk.items(params), queryFn: get<ItemDTO[]>('items', { q: params.q, client: params.clientId, limit: params.limit }), staleTime: MEDIUM, placeholderData: keepPreviousData, ...opts });
export const useVasServices = (params: { includeInactive?: boolean } = {}, opts?: Opts<VasServiceDTO[]>) =>
  useQuery({ queryKey: qk.services(params), queryFn: get<VasServiceDTO[]>('services', { inactive: params.includeInactive }), staleTime: MEDIUM, ...opts });
export const useVasService = (id: string | null | undefined, opts?: Opts<VasServiceDTO>) => useQuery({ queryKey: qk.service(id ?? ''), queryFn: get<VasServiceDTO>(`services/${id}`), enabled: Boolean(id), staleTime: MEDIUM, ...opts });
export const useStandards = (params: { jobTypeId?: string | null; serviceId?: string | null; clientId?: string | null } = {}, opts?: Opts<StandardDTO[]>) =>
  useQuery({ queryKey: qk.standards(params), queryFn: get<StandardDTO[]>('standards', { jobType: params.jobTypeId, service: params.serviceId, client: params.clientId }), staleTime: MEDIUM, ...opts });
export const useStandardSuggestion = (params: { jobTypeId: string | null | undefined; clientId?: string | null; laborClassId?: string | null }, opts?: Opts<PaceSuggestionDTO>) =>
  useQuery({ queryKey: qk.standardSuggestion(params), queryFn: get<PaceSuggestionDTO>('standards/suggest', { jobType: params.jobTypeId, client: params.clientId, laborClass: params.laborClassId }), enabled: Boolean(params.jobTypeId), staleTime: MEDIUM, ...opts });
export const useTargets = (params: { scope?: TargetScope | null; scopeId?: string | null; month?: string | null } = {}, opts?: Opts<TargetDTO[]>) =>
  useQuery({ queryKey: qk.targets(params), queryFn: get<TargetDTO[]>('targets', params), staleTime: MEDIUM, ...opts });

/* ---------------------------------------------------------------- jobs */

export interface JobListParams {
  tab?: JobTab;
  q?: string | null;
  clientId?: string | null;
  jobTypeId?: string | null;
  siteId?: string | null;
  ownerId?: string | null;
  status?: readonly JobStatusValue[];
  risk?: readonly PulseStatus[];
  includeArchived?: boolean;
  includeDeleted?: boolean;
  limit?: number;
}
const jobQuery = (params: JobListParams): Query => ({
  tab: params.tab,
  q: params.q,
  client: params.clientId,
  jobType: params.jobTypeId,
  site: params.siteId,
  owner: params.ownerId,
  status: list(params.status),
  risk: list(params.risk),
  archived: params.includeArchived,
  deleted: params.includeDeleted,
  limit: params.limit,
});
export const useJobs = (params: JobListParams = {}, opts?: Opts<JobListItemDTO[]>) =>
  useQuery({ queryKey: qk.jobs(jobQuery(params)), queryFn: get<JobListItemDTO[]>('jobs', jobQuery(params)), staleTime: SHORT, placeholderData: keepPreviousData, ...opts });
export const useJobsNeedingAttention = (limit = 10, opts?: Opts<JobListItemDTO[]>) =>
  useQuery({ queryKey: qk.jobsAttention(limit), queryFn: get<JobListItemDTO[]>('jobs/attention', { limit }), staleTime: SHORT, ...opts });
export type JobRiskCounts = Readonly<Record<PulseStatus | 'none', number>>;
export const useJobCounts = (params: { clientId?: string | null; jobTypeId?: string | null; siteId?: string | null } = {}, opts?: Opts<JobRiskCounts>) =>
  useQuery({ queryKey: qk.jobCounts(params), queryFn: get<JobRiskCounts>('jobs/counts', { client: params.clientId, jobType: params.jobTypeId, site: params.siteId }), staleTime: SHORT, ...opts });
export const useJobsByLink = (type: string | null | undefined, id: string | null | undefined, opts?: Opts<JobListItemDTO[]>) =>
  useQuery({ queryKey: qk.jobsByLink(type ?? '', id ?? ''), queryFn: get<JobListItemDTO[]>('jobs/by-link', { type, id }), enabled: Boolean(type && id), staleTime: SHORT, ...opts });
export const useDeletedJobs = (opts?: Opts<DeletedJobDTO[]>) => useQuery({ queryKey: qk.deletedJobs(), queryFn: get<DeletedJobDTO[]>('jobs/deleted'), staleTime: SHORT, ...opts });
/** One job by id or job number. */
export const useJob = (ref: string | null | undefined, opts?: Opts<JobDetailDTO>) =>
  useQuery({ queryKey: qk.job(ref ?? ''), queryFn: get<JobDetailDTO>(`jobs/${encodeURIComponent(ref ?? '')}`), enabled: Boolean(ref), staleTime: SHORT, ...opts });
export const useJobPlans = (ref: string | null | undefined, opts?: Opts<JobPlansDTO>) =>
  useQuery({ queryKey: qk.jobPlans(ref ?? ''), queryFn: get<JobPlansDTO>(`jobs/${encodeURIComponent(ref ?? '')}/plans`), enabled: Boolean(ref), staleTime: SHORT, ...opts });
export const useJobPrices = (ref: string | null | undefined, opts?: Opts<JobPriceDTO[]>) =>
  useQuery({ queryKey: qk.jobPrices(ref ?? ''), queryFn: get<JobPriceDTO[]>(`jobs/${encodeURIComponent(ref ?? '')}/prices`), enabled: Boolean(ref), staleTime: SHORT, ...opts });
/** A job's numbers per day, week or month over its whole life. */
export const useJobDays = (ref: string | null | undefined, by: 'day' | 'week' | 'month' = 'day', opts?: Opts<ProfitResponse>) =>
  useQuery({ queryKey: qk.jobDays(ref ?? '', by), queryFn: get<ProfitResponse>(`jobs/${encodeURIComponent(ref ?? '')}/days`, { by }), enabled: Boolean(ref), staleTime: SHORT, ...opts });

/* ---------------------------------------------------------------- daily streams */

export const useLogGrid = (params: { date?: string | null; siteId?: string | null } = {}, opts?: Opts<LogGridDTO>) =>
  useQuery({ queryKey: qk.logGrid(params.date, params.siteId), queryFn: get<LogGridDTO>('log', { date: params.date, site: params.siteId }), staleTime: 5_000, placeholderData: keepPreviousData, ...opts });
export const usePreviousCrew = (params: { date: string | null | undefined; siteId?: string | null }, opts?: Opts<PreviousCrewDTO[]>) =>
  useQuery({ queryKey: qk.previousCrew(params.date ?? '', params.siteId), queryFn: get<PreviousCrewDTO[]>('log/previous-crew', { date: params.date, site: params.siteId }), enabled: Boolean(params.date), staleTime: MEDIUM, ...opts });

export interface EntryListParams {
  jobId?: string | null;
  clientId?: string | null;
  siteId?: string | null;
  from?: string | null;
  to?: string | null;
  includeDeleted?: boolean;
  limit?: number;
}
const entryQuery = (params: EntryListParams): Query => ({ job: params.jobId, client: params.clientId, site: params.siteId, from: params.from, to: params.to, deleted: params.includeDeleted, limit: params.limit });

export interface ProductionListParams extends EntryListParams {
  laborClassId?: string | null;
  source?: StreamSource | null;
  needsHours?: boolean;
  offset?: number;
}
export const useProduction = (params: ProductionListParams = {}, opts?: Opts<ProductionEntryDTO[]>) => {
  const query = { ...entryQuery(params), laborClass: params.laborClassId, source: params.source, needsHours: params.needsHours, offset: params.offset };
  return useQuery({ queryKey: qk.production(query), queryFn: get<ProductionEntryDTO[]>('production', query), staleTime: SHORT, placeholderData: keepPreviousData, ...opts });
};
export const useIndirect = (params: EntryListParams = {}, opts?: Opts<IndirectEntryDTO[]>) =>
  useQuery({ queryKey: qk.indirect(entryQuery(params)), queryFn: get<IndirectEntryDTO[]>('indirect', entryQuery(params)), staleTime: SHORT, ...opts });
export const usePaidHours = (params: EntryListParams = {}, opts?: Opts<PaidHoursDTO[]>) =>
  useQuery({ queryKey: qk.paidHours(entryQuery(params)), queryFn: get<PaidHoursDTO[]>('paid-hours', entryQuery(params)), staleTime: SHORT, ...opts });
export const useMaterialUsage = (params: EntryListParams = {}, opts?: Opts<MaterialUsageDTO[]>) =>
  useQuery({ queryKey: qk.materials(entryQuery(params)), queryFn: get<MaterialUsageDTO[]>('materials', entryQuery(params)), staleTime: SHORT, ...opts });
export const useCosts = (params: EntryListParams & { scope?: CostScope | null } = {}, opts?: Opts<CostEntryDTO[]>) => {
  const query = { ...entryQuery(params), scope: params.scope };
  return useQuery({ queryKey: qk.costs(query), queryFn: get<CostEntryDTO[]>('costs', query), staleTime: SHORT, ...opts });
};
export const useRevenue = (params: EntryListParams & { kind?: StoredRevenueKind | null } = {}, opts?: Opts<RevenueEntryDTO[]>) => {
  const query = { ...entryQuery(params), kind: params.kind };
  return useQuery({ queryKey: qk.revenue(query), queryFn: get<RevenueEntryDTO[]>('revenue', query), staleTime: SHORT, ...opts });
};
export const useVasEntries = (params: EntryListParams & { serviceId?: string | null; noPrice?: boolean; openMonths?: boolean } = {}, opts?: Opts<VasEntryDTO[]>) => {
  const query = { ...entryQuery(params), service: params.serviceId, noPrice: params.noPrice, open: params.openMonths };
  return useQuery({ queryKey: qk.serviceEntries(query), queryFn: get<VasEntryDTO[]>('service-entries', query), staleTime: SHORT, ...opts });
};
export const useDayReviews = (params: { siteId?: string | null; from?: string | null; to?: string | null; status?: DayReviewStatus | null } = {}, opts?: Opts<DayReviewDTO[]>) => {
  const query = { site: params.siteId, from: params.from, to: params.to, status: params.status };
  return useQuery({ queryKey: qk.dayReviews(query), queryFn: get<DayReviewDTO[]>('day-reviews', query), staleTime: SHORT, ...opts });
};

/* ---------------------------------------------------------------- profit */

export interface ProfitParams {
  from?: string | null;
  to?: string | null;
  siteId?: string | null;
  clientId?: string | null;
  jobTypeId?: string | null;
  jobId?: string | null;
  serviceId?: string | null;
  status?: JobStatusValue | null;
  /** Only rows put on a client with no job. Read by the entries drill down. */
  noJob?: boolean;
  /** How company costs are shared over part of a month, for this view only. Read by company profit. */
  spread?: 'calendar' | 'work_days' | null;
}
const profitQuery = (params: ProfitParams): Query => ({ from: params.from, to: params.to, site: params.siteId, client: params.clientId, jobType: params.jobTypeId, job: params.noJob ? 'none' : params.jobId, service: params.serviceId, status: params.status, spread: params.spread });

export const useSummary = (params: { from?: string | null; to?: string | null; siteId?: string | null } = {}, opts?: Opts<SummaryDTO>) => {
  const query = { from: params.from, to: params.to, site: params.siteId };
  return useQuery({ queryKey: qk.summary(query), queryFn: get<SummaryDTO>('summary', query), staleTime: SHORT, placeholderData: keepPreviousData, ...opts });
};
/** The Profit explorer rows for one grouping. `compare` adds the prior period, `trend` a sparkline per row. */
export const useProfit = (by: ProfitGroup, params: ProfitParams & { compare?: boolean; trend?: boolean } = {}, opts?: Opts<ProfitResponse>) => {
  const query = { ...profitQuery(params), by, compare: params.compare, trend: params.trend };
  return useQuery({ queryKey: qk.profit(by, query), queryFn: get<ProfitResponse>('profit', query), staleTime: SHORT, placeholderData: keepPreviousData, ...opts });
};
export const useProfitTrend = (params: ProfitParams & { bucket?: 'day' | 'week' | 'month' } = {}, opts?: Opts<TrendPointDTO[]>) => {
  const query = { ...profitQuery(params), bucket: params.bucket };
  return useQuery({ queryKey: qk.profitTrend(query), queryFn: get<TrendPointDTO[]>('profit/trend', query), staleTime: SHORT, placeholderData: keepPreviousData, ...opts });
};
/**
 * The stamped rows behind a number (drill down): all of them. The route answers one page at a
 * time, so this reads every page before it hands the rows over, and a total over `rows` is the
 * whole total. `truncated` is true only when it stopped at `maxRows`: then say the list is cut.
 * `limit` is the page size, not a cap on the rows.
 */
export const useProfitFacts = (params: ProfitParams & { kinds?: readonly FactKind[]; limit?: number; maxRows?: number } = {}, opts?: Opts<AllRows<FactRowDTO>>) => {
  const query = { ...profitQuery(params), kinds: list(params.kinds), limit: params.limit ?? 5000 };
  return useQuery({
    queryKey: qk.profitFacts({ ...query, maxRows: params.maxRows }),
    queryFn: () => collectPages<FactRowDTO>((offset) => apiGetPage<FactRowDTO[], PageMeta>(apiPath('profit/facts', { ...query, offset })), { maxRows: params.maxRows }),
    staleTime: SHORT,
    ...opts,
  });
};
export const useCompanyBridge = (params: { from?: string | null; to?: string | null; siteId?: string | null; spread?: 'calendar' | 'work_days' | null } = {}, opts?: Opts<CompanyBridgeDTO>) => {
  const query = { from: params.from, to: params.to, site: params.siteId, spread: params.spread };
  return useQuery({ queryKey: qk.companyBridge(query), queryFn: get<CompanyBridgeDTO>('company-bridge', query), staleTime: SHORT, placeholderData: keepPreviousData, ...opts });
};

/** The Labor page: by class, by reason, by day, with the bridge numbers. */
export const useLaborSummary = (params: { from?: string | null; to?: string | null; siteId?: string | null } = {}, opts?: Opts<LaborSummaryDTO>) => {
  const query = { from: params.from, to: params.to, site: params.siteId };
  return useQuery({ queryKey: qk.laborSummary(query), queryFn: get<LaborSummaryDTO>('labor/summary', query), staleTime: SHORT, placeholderData: keepPreviousData, ...opts });
};

/* ---------------------------------------------------------------- control */

export const usePeriods = (opts?: Opts<PeriodDTO[]>) => useQuery({ queryKey: qk.periods(), queryFn: get<PeriodDTO[]>('periods'), staleTime: MEDIUM, ...opts });
export const useCloseChecklist = (month: string | null | undefined, opts?: Opts<CloseChecklistDTO>) =>
  useQuery({ queryKey: qk.closeChecklist(month ?? ''), queryFn: get<CloseChecklistDTO>(`periods/${month}/checklist`), enabled: Boolean(month), staleTime: SHORT, ...opts });

export const useAlerts = (params: { status?: AlertStatus | 'all'; entityType?: AlertEntityType | null; entityId?: string | null; assignedTo?: string | null; limit?: number } = {}, opts?: Opts<AlertDTO[]>) =>
  useQuery({ queryKey: qk.alerts(params), queryFn: get<AlertDTO[]>('alerts', params), staleTime: SHORT, placeholderData: keepPreviousData, ...opts });
export const useAlertsUnread = (opts?: Opts<{ count: number }>) => useQuery({ queryKey: qk.alertsUnread(), queryFn: get<{ count: number }>('alerts/unread'), staleTime: SHORT, refetchInterval: 60_000, ...opts });
export const useAlertRules = (opts?: Opts<AlertRuleDTO[]>) => useQuery({ queryKey: qk.alertRules(), queryFn: get<AlertRuleDTO[]>('alert-rules'), staleTime: MEDIUM, ...opts });
export const useNotifications = (params: { unreadOnly?: boolean; limit?: number } = {}, opts?: Opts<NotificationDTO[]>) =>
  useQuery({ queryKey: qk.notifications(params), queryFn: get<NotificationDTO[]>('notifications', { unread: params.unreadOnly, limit: params.limit }), staleTime: SHORT, ...opts });

export const useSavedViews = (page?: SavedViewPage | null, opts?: Opts<SavedViewDTO[]>) => useQuery({ queryKey: qk.views(page), queryFn: get<SavedViewDTO[]>('views', { page }), staleTime: MEDIUM, ...opts });
export const useUserPrefs = (opts?: Opts<UserPrefsDTO>) => useQuery({ queryKey: qk.prefs(), queryFn: get<UserPrefsDTO>('prefs'), staleTime: MEDIUM, ...opts });

export interface ActivityParams {
  jobId?: string | null;
  clientId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  verb?: string | null;
  from?: string | null;
  to?: string | null;
  cursor?: string | null;
  limit?: number;
}
/** One page of the audit feed. Pass the last page's `nextCursor` as `cursor` for the next one. */
export const useActivity = (params: ActivityParams = {}, opts?: Opts<Page<ActivityDTO>>) => {
  const query = { job: params.jobId, client: params.clientId, entityType: params.entityType, entityId: params.entityId, actor: params.actorId, verb: params.verb, from: params.from, to: params.to, cursor: params.cursor, limit: params.limit };
  return useQuery({ queryKey: qk.activity(query), queryFn: get<Page<ActivityDTO>>('activity', query), staleTime: SHORT, ...opts });
};

/** Jobs, clients and services for the command palette. Runs from 2 characters. */
export const useSearch = (q: string, opts?: Opts<SearchHitDTO[]>) =>
  useQuery({ queryKey: qk.search(q), queryFn: get<SearchHitDTO[]>('search', { q }), enabled: q.trim().length >= 2, staleTime: SHORT, placeholderData: keepPreviousData, ...opts });

/* ---------------------------------------------------------------- profit team: explain, pivot, drill down, reports */

/** "How we got this" for one number. Loads when `enabled` (the popover is open). */
export const useExplain = (metric: string, params: ProfitParams = {}, opts?: Opts<import('@/lib/types').ExplainDTO>) => {
  const query = { metric, ...profitQuery(params) };
  return useQuery({ queryKey: qk.explain(metric, query), queryFn: get<import('@/lib/types').ExplainDTO>('explain', query), staleTime: SHORT, ...opts });
};
/** Profit grouped by two things at once. */
export const useProfitPivot = (rows: ProfitGroup, cols: ProfitGroup, params: ProfitParams = {}, opts?: Opts<import('@/lib/types').ProfitPivotDTO>) => {
  const query = { rows, cols, ...profitQuery(params) };
  return useQuery({ queryKey: qk.profitPivot(rows, cols, query), queryFn: get<import('@/lib/types').ProfitPivotDTO>('profit/pivot', query), staleTime: SHORT, placeholderData: keepPreviousData, ...opts });
};
/** The named rows behind a profit number (the last stop of a drill down). */
export const useProfitEntries = (params: ProfitParams & { kinds?: readonly FactKind[]; limit?: number } = {}, opts?: Opts<import('@/lib/types').ProfitEntriesDTO>) => {
  const query = { ...profitQuery(params), kinds: list(params.kinds), limit: params.limit };
  return useQuery({ queryKey: qk.profitEntries(query), queryFn: get<import('@/lib/types').ProfitEntriesDTO>('profit/entries', query), staleTime: SHORT, placeholderData: keepPreviousData, ...opts });
};
export interface ReportParams {
  from?: string | null;
  to?: string | null;
  siteId?: string | null;
  clientId?: string | null;
  jobTypeId?: string | null;
  status?: JobStatusValue | null;
}
/** The query string of a report, shared by the page, the CSV link and the print link. */
export const reportQuery = (params: ReportParams): Query => ({ from: params.from, to: params.to, site: params.siteId, client: params.clientId, jobType: params.jobTypeId, status: params.status });
export const useReport = (slug: string, params: ReportParams = {}, opts?: Opts<import('@/lib/types').ReportDTO>) => {
  const query = reportQuery(params);
  return useQuery({ queryKey: qk.report(slug, query), queryFn: get<import('@/lib/types').ReportDTO>(`reports/${encodeURIComponent(slug)}`, query), staleTime: SHORT, placeholderData: keepPreviousData, ...opts });
};
export const useReportSchedules = (opts?: Opts<import('@/lib/types').ReportScheduleDTO[]>) => useQuery({ queryKey: qk.reportSchedules(), queryFn: get<import('@/lib/types').ReportScheduleDTO[]>('reports/schedules'), staleTime: SHORT, ...opts });
export const useReportRuns = (opts?: Opts<import('@/lib/types').ReportRunDTO[]>) => useQuery({ queryKey: qk.reportRuns(), queryFn: get<import('@/lib/types').ReportRunDTO[]>('reports/runs'), staleTime: SHORT, ...opts });
