'use client';
/**
 * Program read hooks over /api/v1/programs/** (docs/programs/SPEC.md 4.8). Each accepts
 * `initialData` (through `opts`) so server components render instantly. Builds also live under
 * `qk.project(key)`: build mutations invalidate `qk.program(key)`, `qk.projectTasks(key)` and
 * `qk.programsToday(date)` (see `programInvalidations`).
 */
import { useEffect, useState } from 'react';
import { useQuery, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import { apiGet, apiPath, apiPost } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type {
  AttributeDTO,
  BuildsPageDTO,
  CardImpactDTO,
  CardLineInput,
  CardVersionDTO,
  CloseChecklistDTO,
  DashboardProgramsDTO,
  FloorTodayDTO,
  IsoDate,
  IsoMonth,
  LinkedRecordDTO,
  LinkedWorkDTO,
  OneTimeChargeDTO,
  OrgCalendarDTO,
  OutputSheetDTO,
  ProgramDetailDTO,
  ProgramListItemDTO,
  ProgramRangeDTO,
  ProgramSummaryDTO,
  ProgramTemplateDTO,
  ProgramWizardPayload,
  RateRuleInput,
  RunDTO,
  ScheduleDTO,
  ScheduleInput,
  SchedulePreviewDTO,
  TrendsDTO,
  VariantDTO,
  WizardDraftDTO,
} from '@/lib/program-types';
import type { ActivityDTO } from '@/lib/types';

type Opts<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, 'queryKey' | 'queryFn'>;
const p = (key: string, rest = '') => `programs/${encodeURIComponent(key)}${rest}`;

export interface ProgramFilters {
  readonly status?: string;
  readonly customer?: string;
  readonly q?: string;
  readonly ids?: string;
  readonly owner?: string;
  readonly health?: string;
  readonly archived?: boolean;
}

export interface BuildWindow {
  readonly from?: IsoDate;
  readonly to?: IsoDate;
  readonly status?: string;
  readonly variant?: string;
  readonly assignee?: string;
  readonly run?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface KitCapacityDTO {
  readonly available: boolean;
  readonly reason?: string;
  readonly product?: { readonly id: string; readonly sku: string; readonly name: string; readonly url: string };
  readonly warehouses?: readonly { readonly id: string; readonly name: string; readonly netKittingCapacity: string; readonly currentInventoryQty: string; readonly pendingOrderQty: string; readonly asOf: string }[];
  readonly note?: string | null;
}

export interface PlannerCapacityDTO {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly variants: readonly { readonly variantId: string; readonly available: boolean; readonly canBuild: number | null; readonly plannedQty: string; readonly firstShort: { readonly component: { readonly sku: string; readonly name: string }; readonly need: string; readonly free: string; readonly short: string } | null }[];
}

export interface OtherPricesDTO {
  readonly cardUnitPrice: string | null;
  readonly pulse: readonly { readonly jobId: string; readonly number: string; readonly name: string; readonly unitPrice: string | null; readonly mismatch: boolean }[];
  readonly wms: { readonly available: boolean; readonly reason?: string; readonly fees?: readonly { readonly id: string; readonly name: string; readonly operationType: string; readonly standardRate: number | null }[] };
}

export interface ProgramPulseDTO {
  readonly available: boolean;
  readonly reason?: string;
  readonly moneyHidden?: boolean;
  readonly job?: { readonly id: string; readonly number: string; readonly name: string; readonly status: string; readonly unitLabel: string; readonly path: string } | null;
  readonly stamped?: { readonly perUnitCents: string | null; readonly feesCents: string | null; readonly totalCents: string | null; readonly byVariant: readonly { readonly variantId: string | null; readonly units: string; readonly revenueCents?: string; readonly marginBp?: number | null }[] };
  readonly pendingSync?: boolean;
  readonly pendingSince?: string | null;
  readonly lastSyncAt?: string | null;
}

export interface ProjectRecordLinksDTO {
  readonly links: readonly LinkedRecordDTO[];
  readonly programs: readonly { readonly key: string; readonly name: string; readonly units: string }[];
}

export interface ProgramActivityPage {
  readonly items: readonly ActivityDTO[];
  readonly nextCursor: string | null;
}

/** Every cache key a build mutation touches (4.8). */
export function programInvalidations(key: string, date?: IsoDate | null): QueryKey[] {
  return [qk.program(key), qk.projectTasks(key), ...(date ? [qk.programsToday(date)] : [['programs', 'today']])];
}

/** A value that settles `delay` ms after its last change (the card preview is debounced 300ms). */
function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

export const usePrograms = (filters: ProgramFilters = {}, opts?: Opts<ProgramListItemDTO[]>) =>
  useQuery({ queryKey: qk.programs({ ...filters }), queryFn: () => apiGet<ProgramListItemDTO[]>(apiPath('programs', { ...filters })), ...opts });

export const useFloorToday = (date: IsoDate, opts?: Opts<FloorTodayDTO>) =>
  useQuery({ queryKey: qk.programsToday(date), queryFn: () => apiGet<FloorTodayDTO>(apiPath('programs/today', { date })), staleTime: 15_000, ...opts });

export const useProgramTrends = (from: IsoMonth, to: IsoMonth, group: 'program' | 'customer', opts?: Opts<TrendsDTO>) =>
  useQuery({ queryKey: qk.programTrends(from, to, group), queryFn: () => apiGet<TrendsDTO>(apiPath('programs/trends', { from, to, group })), ...opts });

export const useDashboardPrograms = (opts?: Opts<DashboardProgramsDTO>) =>
  useQuery({ queryKey: ['programs', 'dashboard'], queryFn: () => apiGet<DashboardProgramsDTO>(apiPath('programs/dashboard')), staleTime: 30_000, ...opts });

export const useProgram = (key: string, opts?: Opts<ProgramDetailDTO>) =>
  useQuery({ queryKey: qk.program(key), queryFn: () => apiGet<ProgramDetailDTO>(apiPath(p(key))), ...opts });

export const useProgramSummary = (key: string, month: IsoMonth, opts?: Opts<ProgramSummaryDTO>) =>
  useQuery({ queryKey: qk.programSummary(key, month), queryFn: () => apiGet<ProgramSummaryDTO>(apiPath(p(key, '/summary'), { month })), staleTime: 30_000, ...opts });

export const useProgramRange = (key: string, from: IsoDate, to: IsoDate, opts?: Opts<ProgramRangeDTO>) =>
  useQuery({ queryKey: qk.programRange(key, from, to), queryFn: () => apiGet<ProgramRangeDTO>(apiPath(p(key, '/range'), { from, to })), staleTime: 60_000, ...opts });

export const useProgramBuilds = (key: string, window: BuildWindow = {}, opts?: Opts<BuildsPageDTO>) =>
  useQuery({ queryKey: qk.programBuilds(key, { ...window }), queryFn: () => apiGet<BuildsPageDTO>(apiPath(p(key, '/builds'), { ...window })), staleTime: 15_000, ...opts });

export const useProgramRuns = (key: string, window: { readonly from: IsoDate; readonly to: IsoDate }, opts?: Opts<RunDTO[]>) =>
  useQuery({ queryKey: qk.programRuns(key, { ...window }), queryFn: () => apiGet<RunDTO[]>(apiPath(p(key, '/runs'), { ...window })), staleTime: 15_000, ...opts });

export const useOutputSheet = (key: string, date: IsoDate, runId?: string | null, opts?: Opts<OutputSheetDTO>) =>
  useQuery({ queryKey: qk.programOutput(key, date, runId), queryFn: () => apiGet<OutputSheetDTO>(apiPath(p(key, '/output'), { date, run: runId ?? undefined })), staleTime: 5_000, ...opts });

export const useVariants = (key: string, includeRetired = false, opts?: Opts<VariantDTO[]>) =>
  useQuery({ queryKey: [...qk.programVariants(key), includeRetired], queryFn: () => apiGet<VariantDTO[]>(apiPath(p(key, '/variants'), { retired: includeRetired ? 1 : undefined })), ...opts });

export const useAttributes = (key: string, opts?: Opts<AttributeDTO[]>) =>
  useQuery({ queryKey: qk.programAttributes(key), queryFn: () => apiGet<AttributeDTO[]>(apiPath(p(key, '/attributes'))), ...opts });

export const usePriceCard = (key: string, opts?: Opts<CardVersionDTO[]>) =>
  useQuery({ queryKey: qk.programCard(key), queryFn: () => apiGet<CardVersionDTO[]>(apiPath(p(key, '/price-card'))), ...opts });

/** The impact preview of a draft, debounced 300ms (POST, read only). */
export function useCardPreview(key: string, draft: { readonly versionId: string; readonly effectiveFrom?: IsoDate; readonly lines?: readonly CardLineInput[]; readonly rules?: readonly RateRuleInput[] } | null, opts?: Opts<CardImpactDTO>) {
  const settled = useDebounced(draft, 300);
  return useQuery({
    queryKey: [...qk.programCard(key), 'preview', settled],
    queryFn: () => apiPost<CardImpactDTO>(apiPath(p(key, '/price-card/preview')), settled),
    enabled: Boolean(settled),
    staleTime: 10_000,
    ...opts,
  });
}

export const useOneTimeCharges = (key: string, month: IsoMonth, opts?: Opts<OneTimeChargeDTO[]>) =>
  useQuery({ queryKey: qk.programOneTime(key, month), queryFn: () => apiGet<OneTimeChargeDTO[]>(apiPath(p(key, '/one-time'), { month })), ...opts });

export const useOtherPrices = (key: string, opts?: Opts<OtherPricesDTO>) =>
  useQuery({ queryKey: qk.programOtherPrices(key), queryFn: () => apiGet<OtherPricesDTO>(apiPath(p(key, '/other-prices'))), retry: false, staleTime: 60_000, ...opts });

export const useSchedules = (key: string, opts?: Opts<ScheduleDTO[]>) =>
  useQuery({ queryKey: qk.programSchedules(key), queryFn: () => apiGet<ScheduleDTO[]>(apiPath(p(key, '/schedules'))), ...opts });

export function useSchedulePreview(key: string, input: ScheduleInput | null, range: { readonly from: IsoDate; readonly to: IsoDate }, opts?: Opts<SchedulePreviewDTO>) {
  const settled = useDebounced(input, 300);
  return useQuery({
    queryKey: [...qk.programSchedules(key), 'preview', settled, range.from, range.to],
    queryFn: () => apiPost<SchedulePreviewDTO>(apiPath(p(key, '/schedules/preview')), { input: settled, ...range }),
    enabled: Boolean(settled),
    staleTime: 10_000,
    ...opts,
  });
}

export const useProgramLinks = (key: string, opts?: Opts<LinkedRecordDTO[]>) =>
  useQuery({ queryKey: qk.programLinks(key), queryFn: () => apiGet<LinkedRecordDTO[]>(apiPath(p(key, '/links'))), ...opts });

export const useBuildLinks = (id: string, opts?: Opts<LinkedRecordDTO[]>) =>
  useQuery({ queryKey: qk.buildLinks(id), queryFn: () => apiGet<LinkedRecordDTO[]>(apiPath(`builds/${encodeURIComponent(id)}/links`)), ...opts });

export const useProjectRecordLinks = (key: string, opts?: Opts<ProjectRecordLinksDTO>) =>
  useQuery({ queryKey: qk.projectRecordLinks(key), queryFn: () => apiGet<ProjectRecordLinksDTO>(apiPath(`projects/${encodeURIComponent(key)}/record-links`)), ...opts });

export const useLinkedWork = (key: string, month: IsoMonth, opts?: Opts<LinkedWorkDTO>) =>
  useQuery({ queryKey: qk.programLinkedWork(key, month), queryFn: () => apiGet<LinkedWorkDTO>(apiPath(p(key, '/linked-work'), { month })), ...opts });

export const usePlannerCapacity = (key: string, from: IsoDate, to: IsoDate, opts?: Opts<PlannerCapacityDTO>) =>
  useQuery({ queryKey: qk.plannerCapacity(key, from, to), queryFn: () => apiGet<PlannerCapacityDTO>(apiPath(p(key, '/planner-capacity'), { from, to })), retry: false, staleTime: 60_000, ...opts });

export const useVariantKit = (key: string, variantId: string, opts?: Opts<KitCapacityDTO>) =>
  useQuery({ queryKey: qk.variantKit(key, variantId), queryFn: () => apiGet<KitCapacityDTO>(apiPath(p(key, `/variants/${encodeURIComponent(variantId)}/kit`))), retry: false, staleTime: 60_000, ...opts });

export const useProgramPulse = (key: string, opts?: Opts<ProgramPulseDTO>) =>
  useQuery({ queryKey: qk.programPulse(key), queryFn: () => apiGet<ProgramPulseDTO>(apiPath(p(key, '/pulse'))), retry: false, staleTime: 30_000, refetchInterval: 120_000, ...opts });

export const useCloseChecklist = (key: string, month: IsoMonth, opts?: Opts<CloseChecklistDTO>) =>
  useQuery({ queryKey: qk.programClose(key, month), queryFn: () => apiGet<CloseChecklistDTO>(apiPath(p(key, '/close'), { month })), ...opts });

export const useProgramActivity = (key: string, filter = 'all', opts?: Opts<ProgramActivityPage>) =>
  useQuery({ queryKey: qk.programActivity(key, filter), queryFn: () => apiGet<ProgramActivityPage>(apiPath(p(key, '/activity'), { filter })), ...opts });

export const useProgramDrafts = (opts?: Opts<WizardDraftDTO[]>) =>
  useQuery({ queryKey: qk.programDrafts(), queryFn: () => apiGet<WizardDraftDTO[]>(apiPath('programs/drafts')), ...opts });

export const useProgramTemplates = (opts?: Opts<ProgramTemplateDTO[]>) =>
  useQuery({ queryKey: qk.programTemplates(), queryFn: () => apiGet<ProgramTemplateDTO[]>(apiPath('programs/templates')), ...opts });

export const useProgramPrefill = (params: { readonly crmItem?: string; readonly template?: string; readonly copy?: string; readonly customer?: string }, opts?: Opts<ProgramWizardPayload>) =>
  useQuery({ queryKey: ['programs', 'prefill', params], queryFn: () => apiGet<ProgramWizardPayload>(apiPath('programs/prefill', { ...params })), staleTime: 60_000, ...opts });

export const useKeySuggestion = (name: string, opts?: Opts<{ suggested: string; taken: string[] }>) =>
  useQuery({ queryKey: ['programs', 'key', name], queryFn: () => apiGet<{ suggested: string; taken: string[] }>(apiPath('programs/keys/suggest', { name })), enabled: name.trim().length > 0, staleTime: 30_000, ...opts });

export const useOrgCalendar = (opts?: Opts<OrgCalendarDTO>) =>
  useQuery({ queryKey: qk.orgCalendar(), queryFn: () => apiGet<OrgCalendarDTO>(apiPath('calendar')), staleTime: 5 * 60_000, ...opts });
