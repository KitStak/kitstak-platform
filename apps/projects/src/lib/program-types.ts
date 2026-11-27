/**
 * Program DTOs and payload schemas (docs/programs/SPEC.md 4.5). Shared by the program domain
 * (`src/server/domain/programs/**`), the server actions, the `/api/v1/programs/**` routes and the
 * program UI. Client safe: types and zod schemas only.
 *
 * Money crosses this boundary as whole cents in decimal strings (`"153000"`), unit prices as
 * 4 decimal dollar strings (`"1.9500"`), quantities as 3 decimal strings. Every DTO that holds
 * money carries `null` money fields when `moneyHidden` is true.
 */
import { z } from 'zod';
import type {
  HourlyTimeBasis,
  LedgerKind,
  OneTimeKind,
  PlannedFrom,
  Posting,
  PriceLineKind,
  PriceSource,
  ProjectRole,
  ProjectStatus,
  ReviewStatus,
  ScheduleStatus,
  SchedulePattern,
  StatusCategory,
  VariantStatus,
  VersionSource,
  VersionState,
} from './constants';
import type { PersonRef, ProjectMemberDTO, StatusDTO, TaskSummary } from './types';

export type IsoDate = string;
export type IsoMonth = string;
export type CentsString = string;

export type Health = 'on_track' | 'at_risk' | 'off_track';
export type HealthBasis = 'money_target' | 'unit_target' | 'plan';
export type RunState = 'planned' | 'in_progress' | 'done' | 'short' | 'cancelled';
export type ProgramTab = 'overview' | 'builds' | 'variants' | 'price-card' | 'schedule' | 'linked' | 'activity' | 'settings';
export type BuildView = 'runs' | 'board' | 'list' | 'table' | 'calendar' | 'timeline';
export type MinimumStatus = 'none' | 'met' | 'short' | 'pending';

export interface UnitLabel {
  readonly singular: string;
  readonly plural: string;
}

export interface ProgramCapabilities {
  readonly canEdit: boolean;
  readonly canPlan: boolean;
  readonly canLog: boolean;
  readonly canPropose: boolean;
  readonly canPrice: boolean;
  readonly canManage: boolean;
  readonly canClose: boolean;
  readonly seesMoney: boolean;
  readonly seesSync: boolean;
}

export interface ProgramCustomerDTO {
  readonly kind: 'core' | 'crm_account';
  readonly id: string;
  readonly name: string;
}

export interface ProgramListItemDTO {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly color: string | null;
  readonly icon: string | null;
  readonly status: ProjectStatus;
  readonly health: Health | null;
  readonly healthBasis: HealthBasis | null;
  readonly healthAuto: boolean;
  readonly customer: ProgramCustomerDTO | null;
  readonly owner: { readonly id: string; readonly name: string } | null;
  readonly unit: UnitLabel;
  readonly variantsCount: number;
  readonly schedulesActive: number;
  readonly scheduleText: string | null;
  readonly today: { readonly date: IsoDate; readonly builds: number; readonly done: number; readonly plannedUnits: string; readonly builtUnits: string };
  readonly month: {
    readonly month: IsoMonth;
    readonly units: string;
    readonly revenueCents: CentsString | null;
    readonly forecastCents: CentsString | null;
    readonly targetCents: CentsString | null;
    readonly targetBp: number | null;
    readonly minimumGapSoFarCents: CentsString | null;
    readonly projectedGapCents: CentsString | null;
    readonly linkedJobsCents: CentsString | null;
  };
  /** Last 30 days. */
  readonly sparkline: readonly { readonly date: IsoDate; readonly units: string }[];
  readonly pulseJob: { readonly id: string; readonly number: string; readonly name: string } | null;
  readonly starred: boolean;
  readonly archivedAt: string | null;
  readonly updatedAt: string;
  readonly moneyHidden: boolean;
}

export interface ProgramSettingsDTO {
  readonly programId: string;
  readonly unitSingular: string;
  readonly unitPlural: string;
  readonly timezone: string;
  readonly workingDays: readonly number[] | null;
  readonly useOrgHolidays: boolean;
  readonly extraDaysOff: readonly IsoDate[];
  readonly extraWorkDays: readonly IsoDate[];
  readonly currency: string;
  readonly monthlyTargetCents: CentsString | null;
  readonly dailyTargetUnits: string | null;
  readonly buildTitlePattern: string;
  readonly autoStartOnOutput: boolean;
  readonly autoDoneWhenFull: boolean;
  readonly moneyMinRole: ProjectRole;
  readonly hourlyTimeBasis: HourlyTimeBasis;
  /** `HH:MM`, or null for Off. */
  readonly remindAt: string | null;
  readonly pausedRanges: readonly { readonly from: IsoDate; readonly to: IsoDate | null }[];
  readonly lockedThrough: IsoDate | null;
  readonly settledThrough: IsoDate | null;
  readonly version: number;
}

export interface ProgramCalendarDTO {
  readonly timezone: string;
  readonly workingDays: readonly number[];
  readonly daysOff: readonly IsoDate[];
  readonly extraWorkDays: readonly IsoDate[];
  readonly activeFrom: IsoDate | null;
  readonly activeTo: IsoDate | null;
  readonly paused: readonly { readonly from: IsoDate; readonly to: IsoDate | null }[];
  readonly today: IsoDate;
  readonly nextWorkDay: IsoDate;
}

export interface OrgCalendarDTO {
  readonly timezone: string;
  readonly workingDays: readonly number[];
  readonly holidays: readonly { readonly date: IsoDate; readonly name: string }[];
  readonly dailyCapacityHours: string | null;
  readonly version: number;
}

export interface CardLineDTO {
  readonly id: string;
  readonly kind: PriceLineKind;
  readonly variantId: string | null;
  readonly ruleId: string | null;
  readonly unitPrice: string | null;
  readonly rateCents: number | null;
  readonly amountCents: CentsString | null;
  readonly prorate: boolean;
  readonly chargeWhilePaused: boolean;
  readonly label: string | null;
  readonly position: number;
}

export interface RateRuleDTO {
  readonly id: string;
  readonly attributeId: string;
  readonly valueId: string;
  readonly op: 'add' | 'set';
  readonly amount: string;
  readonly position: number;
  /** "Size is XL: add $0.25". */
  readonly text: string;
}

export interface CardVersionDTO {
  readonly id: string;
  readonly programId: string;
  readonly number: number | null;
  readonly status: 'draft' | 'published';
  readonly state: VersionState;
  readonly effectiveFrom: IsoDate;
  readonly label: string | null;
  readonly note: string | null;
  readonly source: VersionSource;
  readonly reviewStatus: ReviewStatus;
  readonly reviewNote: string | null;
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
  /** Empty when money is hidden. */
  readonly lines: readonly CardLineDTO[];
  readonly rules: readonly RateRuleDTO[];
  /** "$1.95 per kit · $500.00 monthly fee". Null when money is hidden. */
  readonly summary: string | null;
  readonly version: number;
  readonly moneyHidden: boolean;
}

export interface AttributeValueDTO {
  readonly id: string;
  readonly label: string;
  readonly code: string;
  readonly color: string | null;
}

export interface AttributeDTO {
  readonly id: string;
  readonly name: string;
  readonly values: readonly AttributeValueDTO[];
  readonly position: string;
  readonly version: number;
}

export interface VariantDTO {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly sku: string | null;
  /** `{ [attributeId]: valueId }`. */
  readonly attributes: Readonly<Record<string, string>>;
  readonly defaultQty: string | null;
  readonly packQty: string | null;
  readonly stdMinutesPerUnit: string | null;
  readonly materialCostPerUnit: string | null;
  readonly color: string | null;
  readonly position: string;
  readonly status: VariantStatus;
  readonly coreItem: { readonly id: string; readonly sku: string | null; readonly name: string } | null;
  readonly wmsProduct: { readonly id: string; readonly sku: string | null; readonly name: string } | null;
  readonly currentRate: { readonly unitPrice: string; readonly source: 'variant' | 'card' | 'none'; readonly ruleText: string | null } | null;
  readonly monthUnits: string;
  readonly monthRevenueCents: CentsString | null;
  readonly version: number;
}

export interface OneTimeChargeDTO {
  readonly id: string;
  readonly kind: OneTimeKind;
  readonly chargeOn: IsoDate;
  readonly amountCents: CentsString | null;
  readonly label: string;
  readonly reason: string | null;
  readonly variantId: string | null;
  readonly countsTowardMinimum: boolean;
  readonly locked: boolean;
  readonly version: number;
}

export interface ScheduleLineDTO {
  readonly id: string;
  readonly variantId: string;
  readonly variantName: string;
  readonly qty: string;
  readonly qtyByWeekday: Readonly<Record<string, string>> | null;
  readonly assigneeId: string | null;
  readonly position: number;
}

export interface ScheduleDTO {
  readonly id: string;
  readonly programId: string;
  readonly name: string;
  readonly status: ScheduleStatus;
  readonly pattern: SchedulePattern;
  readonly days: readonly number[];
  readonly intervalWeeks: number;
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate | null;
  readonly leadDays: number;
  readonly skipHolidays: boolean;
  readonly skipDates: readonly IsoDate[];
  readonly defaultAssigneeId: string | null;
  readonly defaultStatusId: string | null;
  readonly generatedThrough: IsoDate | null;
  readonly lastRunAt: string | null;
  /** "Every weekday · 8 kits". */
  readonly text: string;
  readonly nextDate: IsoDate | null;
  readonly lines: readonly ScheduleLineDTO[];
  readonly version: number;
}

export interface SchedulePreviewDTO {
  readonly dates: readonly IsoDate[];
  readonly builds: number;
  readonly units: string;
  readonly text: string;
}

export interface BuildBlockDTO {
  readonly containerKind: 'project' | 'program';
  readonly programId: string | null;
  readonly variantId: string | null;
  readonly variantName: string | null;
  readonly variantColor: string | null;
  readonly buildDate: IsoDate;
  readonly plannedQty: string;
  readonly plannedFrom: PlannedFrom;
  readonly plannedFromText: string;
  readonly builtQty: string;
  readonly remainingQty: string;
  readonly scrapQty: string;
  readonly unplanned: boolean;
  readonly closedShort: boolean;
  readonly closeReason: string | null;
  readonly splitFrom: { readonly id: string; readonly key: string } | null;
  readonly rateOverride: string | null;
  readonly rateOverrideReason: string | null;
  readonly currentPrice: { readonly unitPrice: string; readonly source: PriceSource } | null;
  readonly revenueCents: CentsString | null;
  readonly posting: Posting;
  readonly pulseJob: { readonly id: string; readonly number: string } | null;
  readonly finishedOn: IsoDate | null;
  /** First day the build entered done (kept when it is reopened). */
  readonly firstFinishedOn?: IsoDate | null;
  /**
   * Set when marking this build done again needs the 5.8 choice: it finished earlier in a month
   * that is still open. Send `chargeOn` with `finishBuildAction` ('first_finished' is the default).
   */
  readonly rechargeChoice?: { readonly firstFinishedOn: IsoDate; readonly firstText: string; readonly newText: string } | null;
  readonly batchFeeLocked: boolean;
  readonly runId: string;
  readonly scheduleId: string | null;
  readonly locked: boolean;
  readonly version: number;
}

export interface BuildDTO extends Omit<TaskSummary, 'kind' | 'build'> {
  readonly kind: 'build';
  readonly build: BuildBlockDTO;
}

export interface BuildsPageDTO {
  readonly items: readonly BuildDTO[];
  readonly nextCursor: string | null;
  readonly window: { readonly from: IsoDate; readonly to: IsoDate };
  readonly moneyHidden: boolean;
}

export interface RunDTO {
  readonly id: string;
  readonly programKey: string;
  readonly date: IsoDate;
  readonly name: string;
  readonly scheduleId: string | null;
  readonly state: RunState;
  readonly builds: number;
  readonly done: number;
  readonly cancelled: number;
  readonly plannedUnits: string;
  readonly builtUnits: string;
  readonly revenueCents: CentsString | null;
  readonly buildIds: readonly string[];
}

export interface FloorTodayDTO {
  readonly date: IsoDate;
  readonly capacityHours: string | null;
  readonly programs: readonly {
    readonly key: string;
    readonly name: string;
    readonly unit: UnitLabel;
    readonly runs: readonly RunDTO[];
    readonly estHours: string | null;
    readonly moneyHidden: boolean;
  }[];
  readonly totals: { readonly builds: number; readonly done: number; readonly plannedUnitsByUnit: readonly { readonly unit: string; readonly units: string }[]; readonly estHours: string | null };
}

export interface OutputSheetRow {
  readonly buildId: string;
  readonly key: string;
  readonly title: string;
  readonly variant: { readonly id: string; readonly name: string; readonly color: string | null; readonly sku: string | null } | null;
  readonly buildDate: IsoDate;
  readonly carriedOver: boolean;
  readonly unplanned: boolean;
  readonly runId: string;
  readonly statusId: string;
  readonly statusCategory: StatusCategory;
  readonly plannedQty: string;
  readonly builtBefore: string;
  readonly builtToday: string;
  readonly scrapToday: string;
  readonly outputId: string | null;
  readonly outputVersion: number | null;
  readonly unitPrice: string | null;
  readonly priceSource: PriceSource;
  readonly assignee: PersonRef | null;
  readonly version: number;
  /** Who logged the output of this day, null when nobody has yet (or the person left). The server always sends it. */
  readonly enteredBy?: PersonRef | null;
  /** Where this day's output came from (`manual`, `import`, `form`, ...), null when none. */
  readonly source?: string | null;
  /** The note on this day's output. */
  readonly note?: string | null;
}

export interface OutputSheetDTO {
  readonly date: IsoDate;
  readonly locked: boolean;
  readonly lockReason: string | null;
  readonly nextWorkDay: IsoDate;
  readonly rows: readonly OutputSheetRow[];
  readonly totals: { readonly plannedUnits: string; readonly builtUnits: string; readonly revenueCents: CentsString | null };
  readonly scanIndex: readonly { readonly sku: string | null; readonly variantKey: string | null; readonly buildKey: string; readonly buildId: string; readonly packQty: string }[];
  readonly moneyHidden: boolean;
}

/** The before values of one output batch, for Undo. */
export interface UndoToken {
  readonly date: IsoDate;
  readonly entries: readonly { readonly buildId: string; readonly qty: string; readonly scrapQty: string; readonly statusId: string }[];
  readonly createdBuildIds: readonly string[];
}

export interface ChargeDTO {
  readonly ref: string;
  readonly kind: PriceLineKind | LedgerKind | 'per_unit';
  readonly date: IsoDate;
  readonly cents: CentsString;
  readonly quantity: string | null;
  readonly unitPrice: string | null;
  readonly variantId: string | null;
  readonly buildId: string | null;
  readonly label: string;
  readonly countsTowardMinimum: boolean;
  readonly posted: boolean;
}

export interface MonthResultDTO {
  readonly month: IsoMonth;
  readonly units: string;
  readonly work: { readonly perUnitCents: CentsString; readonly perOrderCents: CentsString; readonly perHourCents: CentsString; readonly totalCents: CentsString } | null;
  readonly fixed: { readonly monthlyFeeCents: CentsString; readonly setupCents: CentsString; readonly totalCents: CentsString } | null;
  readonly adjustments: { readonly totalCents: CentsString; readonly towardMinimumCents: CentsString } | null;
  readonly minimum: { readonly minimumCents: CentsString; readonly gapSoFarCents: CentsString; readonly topUpCents: CentsString; readonly status: MinimumStatus; readonly statusText: string } | null;
  readonly totalCents: CentsString | null;
  readonly unpricedUnits: string;
}

export interface ForecastResultDTO {
  readonly actualCents: CentsString | null;
  readonly recentCents: CentsString | null;
  readonly plannedCents: CentsString | null;
  readonly forecastCents: CentsString | null;
  readonly method: 'planned' | 'recent';
  readonly methodText: string;
  readonly remainingWorkDays: number;
  readonly avgDailyWorkCents: CentsString | null;
  readonly projectedGapCents: CentsString | null;
  readonly targetGapCents: CentsString | null;
  readonly targetBp: number | null;
}

export interface VariantRollupDTO {
  readonly variantId: string | null;
  readonly name: string;
  readonly color: string | null;
  readonly units: string;
  readonly builds: number;
  readonly perUnitCents: CentsString | null;
  readonly perOrderCents: CentsString | null;
  readonly perHourCents: CentsString | null;
  readonly totalCents: CentsString | null;
  readonly avgUnitPrice: string | null;
}

export interface DayRollupDTO {
  readonly date: IsoDate;
  readonly units: string;
  readonly plannedUnits: string;
  readonly workCents: CentsString | null;
  readonly feeCents: CentsString | null;
  readonly cumulativeCents: CentsString | null;
}

export interface TodayDTO {
  readonly date: IsoDate;
  readonly isWorkDay: boolean;
  readonly builds: number;
  readonly done: number;
  readonly plannedUnits: string;
  readonly builtUnits: string;
  readonly revenueCents: CentsString | null;
  readonly runs: readonly RunDTO[];
}

export interface PulseParityDTO {
  readonly available: boolean;
  readonly job: { readonly id: string; readonly number: string; readonly name: string; readonly url: string } | null;
  readonly projectsCents: CentsString | null;
  readonly pulseCents: CentsString | null;
  readonly deltaCents: CentsString | null;
  readonly state: 'matches' | 'catching_up' | 'off' | 'no_job' | 'unavailable';
  readonly text: string;
  readonly pendingSince: string | null;
  readonly lastSyncAt: string | null;
}

export interface LinkedWorkDTO {
  readonly month: IsoMonth;
  readonly programCents: CentsString | null;
  readonly relatedJobs: readonly { readonly id: string; readonly number: string; readonly name: string; readonly revenueCents: CentsString | null; readonly url: string }[];
  readonly relatedCents: CentsString | null;
  readonly totalCents: CentsString | null;
  readonly pulseAvailable: boolean;
}

export type ProgramAlertDTO =
  | { readonly kind: 'no_output_yesterday'; readonly date: IsoDate; readonly builds: number }
  | { readonly kind: 'behind_today'; readonly plannedUnits: string; readonly builtUnits: string }
  | { readonly kind: 'minimum_at_risk'; readonly projectedGapCents: CentsString }
  | { readonly kind: 'unpriced_units'; readonly units: string }
  | { readonly kind: 'no_price_card' }
  | { readonly kind: 'kit_shortage'; readonly variantId: string; readonly sku: string; readonly component: string; readonly shortQty: string; readonly date: IsoDate }
  | { readonly kind: 'version_starts_soon'; readonly versionNumber: number; readonly effectiveFrom: IsoDate }
  | { readonly kind: 'pulse_out_of_sync'; readonly deltaCents: CentsString | null; readonly reason: 'gap' | 'job_deleted' | 'pending' }
  | { readonly kind: 'over_plan'; readonly buildId: string; readonly buildKey: string; readonly overQty: string; readonly date: IsoDate };

export interface ProgramSummaryDTO {
  readonly month: IsoMonth;
  readonly asOf: IsoDate;
  readonly result: MonthResultDTO;
  readonly forecast: ForecastResultDTO;
  readonly byVariant: readonly VariantRollupDTO[];
  readonly byDay: readonly DayRollupDTO[];
  readonly today: TodayDTO;
  readonly alerts: readonly ProgramAlertDTO[];
  readonly pulse: PulseParityDTO | null;
  readonly linkedWork: LinkedWorkDTO | null;
  readonly moneyHidden: boolean;
}

export interface ProgramRangeDTO {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly months: readonly { readonly month: IsoMonth; readonly units: string; readonly totalCents: CentsString | null; readonly workCents: CentsString | null; readonly feeCents: CentsString | null }[];
  readonly days: readonly { readonly date: IsoDate; readonly units: string; readonly workCents: CentsString | null }[];
  readonly totals: { readonly units: string; readonly totalCents: CentsString | null };
  readonly moneyHidden: boolean;
}

export interface StatementLineDTO {
  readonly ref: string;
  readonly kind: ChargeDTO['kind'];
  readonly date: IsoDate;
  readonly label: string;
  readonly quantity: string | null;
  readonly unitPrice: string | null;
  readonly cents: CentsString;
  readonly variantId: string | null;
  readonly variantName: string | null;
}

export interface StatementDTO {
  readonly program: { readonly id: string; readonly key: string; readonly name: string; readonly customer: ProgramCustomerDTO | null; readonly unit: UnitLabel };
  readonly month: IsoMonth;
  readonly asOf: IsoDate;
  readonly closed: boolean;
  readonly byVariant: readonly { readonly variantId: string | null; readonly name: string; readonly units: string; readonly avgUnitPrice: string | null; readonly cents: CentsString }[];
  readonly fees: readonly StatementLineDTO[];
  readonly totals: {
    readonly units: string;
    readonly workCents: CentsString;
    readonly feesCents: CentsString;
    readonly adjustmentsCents: CentsString;
    readonly topUpCents: CentsString;
    readonly totalCents: CentsString;
  };
  readonly minimum: { readonly minimumCents: CentsString; readonly status: MinimumStatus; readonly statusText: string };
}

export type LinkedRecordType =
  | 'core_customer'
  | 'core_item'
  | 'crm_deal'
  | 'crm_account'
  | 'pm_project'
  | 'pm_program'
  | 'pm_task'
  | 'pm_build'
  | 'pm_variant'
  | 'pulse_job'
  | 'wms_work_order'
  | 'wms_shipment_order'
  | 'wms_client'
  | 'wms_product';
export type LinkRelation = 'related' | 'belongs_to' | 'bills_to' | 'uses_kit' | 'created_from';

export interface LinkedRecordDTO {
  /** `core.record_links` id, or `legacy:<table>:<id>` for older links (removable only where they live). */
  readonly linkId: string;
  readonly source: 'record_links' | 'integration_links' | 'job_links';
  readonly type: LinkedRecordType;
  readonly id: string;
  readonly relation: LinkRelation;
  readonly direction: 'out' | 'in';
  readonly title: string;
  readonly status: string | null;
  readonly url: string | null;
  readonly app: 'crm' | 'pulse' | 'wms' | 'projects' | 'core';
  readonly moneyEdge: boolean;
  readonly dangling: boolean;
  readonly removable: boolean;
  readonly createdAt: string | null;
}

export interface CloseChecklistItemDTO {
  readonly key: 'month_over' | 'earlier_closed' | 'open_builds' | 'timers' | 'unpriced' | 'settled' | 'adjustments' | 'pulse';
  readonly label: string;
  readonly ok: boolean;
  readonly required: boolean;
  readonly detail: string | null;
}

export interface CloseChecklistDTO {
  readonly month: IsoMonth;
  readonly closed: boolean;
  readonly closedAt: string | null;
  readonly closedBy: string | null;
  readonly canClose: boolean;
  readonly canReopen: boolean;
  readonly items: readonly CloseChecklistItemDTO[];
  readonly openBuilds: readonly { readonly id: string; readonly key: string; readonly title: string; readonly buildDate: IsoDate; readonly plannedQty: string; readonly builtQty: string }[];
  readonly adjustments: readonly OneTimeChargeDTO[];
  readonly totalCents: CentsString | null;
  readonly units: string;
}

export interface CloseDTO {
  readonly month: IsoMonth;
  readonly closed: boolean;
  readonly lockedThrough: IsoDate | null;
  readonly totalCents: CentsString | null;
  readonly units: string;
}

export interface ImportPreviewDTO {
  readonly kind: 'output' | 'plan';
  readonly token: string;
  readonly rows: readonly { readonly line: number; readonly date: IsoDate; readonly variantId: string; readonly variantName: string; readonly qty: string; readonly scrapQty: string | null; readonly action: 'log' | 'create' | 'create_and_log' | 'refused'; readonly note: string | null }[];
  readonly unmatched: readonly { readonly token: string; readonly lines: readonly number[]; readonly message: string }[];
  readonly problems: readonly { readonly line: number; readonly message: string }[];
  readonly refusedDays: readonly { readonly date: IsoDate; readonly reason: string }[];
  readonly totals: { readonly rows: number; readonly units: string; readonly builds: number };
}

export interface WizardDraftDTO {
  readonly id: string;
  readonly title: string;
  readonly step: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly version: number;
  readonly updatedAt: string;
}

export interface ProgramTemplateDTO {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly payload: ProgramTemplatePayload;
  readonly updatedAt: string;
}

export interface ProgramDetailDTO extends ProgramListItemDTO {
  readonly description: string | null;
  readonly startDate: IsoDate | null;
  readonly endDate: IsoDate | null;
  readonly settings: ProgramSettingsDTO;
  readonly calendar: ProgramCalendarDTO;
  readonly statuses: readonly StatusDTO[];
  readonly members: readonly ProjectMemberDTO[];
  readonly capabilities: ProgramCapabilities;
  readonly locks: { readonly lockedThrough: IsoDate | null; readonly programClosed: readonly IsoMonth[]; readonly pulseClosed: readonly IsoMonth[] };
  readonly currentVersion: CardVersionDTO | null;
  readonly nextVersion: CardVersionDTO | null;
  readonly draftsCount: number;
  readonly pendingRateChanges: { readonly versionId: string; readonly startsOn: IsoDate; readonly count: number } | null;
  readonly setup: { readonly hasPriceCard: boolean; readonly hasVariants: boolean; readonly hasSchedule: boolean; readonly hasPulseJob: boolean | null };
  readonly links: { readonly crmDeal: LinkedRecordDTO | null; readonly crmAccount: LinkedRecordDTO | null; readonly pulseJob: LinkedRecordDTO | null; readonly count: number };
}

export interface CardImpactDTO {
  readonly effectiveFrom: IsoDate;
  readonly openDays: { readonly from: IsoDate; readonly to: IsoDate; readonly count: number } | null;
  readonly lockedDays: { readonly through: IsoDate; readonly reason: 'pulse' | 'program' } | null;
  readonly thisMonth: { readonly beforeCents: CentsString; readonly afterCents: CentsString; readonly deltaCents: CentsString; readonly deltaBp: number | null };
  readonly nextMonth: { readonly beforeCents: CentsString; readonly afterCents: CentsString; readonly deltaCents: CentsString; readonly deltaBp: number | null };
  readonly byVariant: readonly { readonly variantId: string | null; readonly name: string; readonly beforePrice: string | null; readonly afterPrice: string | null; readonly units: string; readonly deltaCents: CentsString }[];
  readonly minimum: { readonly before: CentsString; readonly after: CentsString; readonly gapBefore: CentsString; readonly gapAfter: CentsString };
  readonly rules: readonly { readonly ruleId: string; readonly text: string; readonly variants: number }[];
  readonly conflicts: readonly { readonly variantId: string; readonly text: string }[];
  readonly warnings: readonly ('no_per_unit_line' | 'lower_than_current' | 'starts_in_past' | 'locked_days_keep_old_price' | 'unpriced_variants')[];
}

export interface TrendsDTO {
  readonly from: IsoMonth;
  readonly to: IsoMonth;
  readonly groupBy: 'program' | 'customer';
  readonly months: readonly IsoMonth[];
  readonly rows: readonly { readonly id: string; readonly key: string | null; readonly name: string; readonly unit: string; readonly cells: readonly { readonly month: IsoMonth; readonly units: string; readonly revenueCents: CentsString | null }[]; readonly totalUnits: string; readonly totalCents: CentsString | null; readonly moneyHidden: boolean }[];
  /** Revenue of the rows this viewer may see; null when every row's money is hidden. `moneyHidden` is true when some rows are left out. */
  readonly totals: readonly { readonly month: IsoMonth; readonly revenueCents: CentsString | null; readonly moneyHidden: boolean }[];
}

export interface DashboardProgramsDTO {
  readonly today: { readonly builds: number; readonly done: number; readonly programs: number };
  readonly month: { readonly revenueCents: CentsString | null; readonly forecastCents: CentsString | null; readonly targetCents: CentsString | null };
  readonly atRisk: readonly { readonly key: string; readonly name: string; readonly reason: string }[];
  readonly moneyHidden: boolean;
}

// --- Payload schemas ------------------------------------------------------------------------------

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date.');
const qtyText = z.string().trim().regex(/^\d{1,8}(\.\d{1,3})?$/, 'Use a number with up to 3 decimals.');
const priceText = z.string().trim().regex(/^\d{1,6}(\.\d{1,4})?$/, 'Use a price with up to 4 decimals.');
const signedPriceText = z.string().trim().regex(/^-?\d{1,6}(\.\d{1,4})?$/, 'Use an amount with up to 4 decimals.');
const centsText = z.string().trim().regex(/^-?\d{1,13}$/, 'Use whole cents.');
const positiveCentsText = z.string().trim().regex(/^\d{1,13}$/, 'Use whole cents.');
const idText = z.string().trim().min(1).max(64);
const weekdays = z.array(z.number().int().min(0).max(6)).max(7);
const KEY = /^[A-Z][A-Z0-9]{1,5}$/;

export const unitLabelSchema = z.object({
  singular: z.string().trim().min(1, 'Name one unit.').max(24),
  plural: z.string().trim().min(1, 'Name more than one unit.').max(24),
});

export const cardLineInputSchema = z
  .object({
    id: idText.optional(),
    kind: z.enum(['per_unit', 'per_order', 'per_hour', 'flat_monthly', 'monthly_minimum']),
    variantId: idText.nullable().optional(),
    variantKey: z.string().trim().max(16).nullable().optional(),
    unitPrice: priceText.nullable().optional(),
    rateCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
    amountCents: positiveCentsText.nullable().optional(),
    prorate: z.boolean().optional(),
    chargeWhilePaused: z.boolean().optional(),
    label: z.string().trim().max(80).nullable().optional(),
  })
  .superRefine((line, issue) => {
    if (line.kind === 'per_unit' && !line.unitPrice) issue.addIssue({ code: 'custom', path: ['unitPrice'], message: 'Add a price per unit.' });
    if (line.kind === 'per_hour' && (line.rateCents === null || line.rateCents === undefined)) issue.addIssue({ code: 'custom', path: ['rateCents'], message: 'Add an hourly rate.' });
    if ((line.kind === 'per_order' || line.kind === 'flat_monthly' || line.kind === 'monthly_minimum') && !line.amountCents) {
      issue.addIssue({ code: 'custom', path: ['amountCents'], message: 'Add an amount.' });
    }
  });
export type CardLineInput = z.infer<typeof cardLineInputSchema>;

export const rateRuleInputSchema = z.object({
  id: idText.optional(),
  /** An attribute id, or the attribute name in a wizard payload. */
  attributeId: idText,
  /** A value id, or the value code in a wizard payload. */
  valueId: idText,
  op: z.enum(['add', 'set']),
  amount: signedPriceText,
});
export type RateRuleInput = z.infer<typeof rateRuleInputSchema>;

export const attributeValueInputSchema = z.object({
  id: idText.optional(),
  label: z.string().trim().min(1, 'Name the value.').max(40),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, 'Use 1 to 6 letters or numbers.'),
  color: z.string().trim().max(24).nullable().optional(),
});

export const attributeAxisInputSchema = z.object({
  id: idText.optional(),
  name: z.string().trim().min(1, 'Name the attribute.').max(40),
  values: z.array(attributeValueInputSchema).min(1, 'Add at least one value.').max(30),
});
export type AttributeAxisInput = z.infer<typeof attributeAxisInputSchema>;

export const schedulePatternSchema = z.enum(['daily', 'weekdays', 'custom_days', 'every_n_weeks']);

export const scheduleLineInputSchema = z.object({
  variantKey: z.string().trim().min(1).max(16).optional(),
  variantId: idText.optional(),
  qty: qtyText,
  qtyByWeekday: z.record(z.string().regex(/^[0-6]$/), qtyText).nullable().optional(),
  assigneeId: idText.nullable().optional(),
});

export const scheduleInputSchema = z.object({
  name: z.string().trim().min(1, 'Name the schedule.').max(80),
  pattern: schedulePatternSchema,
  days: weekdays.default([]),
  intervalWeeks: z.number().int().min(1).max(12).default(1),
  startsOn: date,
  endsOn: date.nullable().optional(),
  leadDays: z.number().int().min(0).max(60).default(7),
  skipHolidays: z.boolean().default(true),
  skipDates: z.array(date).max(400).default([]),
  defaultAssigneeId: idText.nullable().optional(),
  defaultStatusId: idText.nullable().optional(),
  lines: z.array(scheduleLineInputSchema).min(1, 'Add at least one variant line.').max(200),
});
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

export const programWizardPayloadSchema = z.object({
  start: z.object({
    mode: z.enum(['scratch', 'deal', 'template', 'copy', 'quick']),
    crmItemId: z.string().max(64).optional(),
    templateId: z.string().max(64).optional(),
    copyKey: z.string().max(6).optional(),
  }),
  basics: z.object({
    name: z.string().trim().min(1, 'Give the program a name.').max(120, 'Program names can be up to 120 characters.'),
    key: z.string().trim().toUpperCase().regex(KEY, 'Use 2 to 6 letters or numbers, starting with a letter.'),
    description: z.string().max(20_000).optional(),
    customer: z.object({ kind: z.enum(['core', 'crm_account']), id: idText }).nullable().optional(),
    ownerId: idText,
    startDate: date,
    endDate: date.nullable().optional(),
    unit: unitLabelSchema,
    timezone: z.string().trim().min(1).max(64),
    calendar: z.object({
      useWorkspace: z.boolean(),
      workingDays: weekdays.min(1, 'Pick at least one work day.').nullable(),
      extraDaysOff: z.array(date).max(400),
      extraWorkDays: z.array(date).max(400),
    }),
    color: z.string().trim().max(32).optional(),
    icon: z.string().trim().max(64).optional(),
    monthlyTargetCents: positiveCentsText.nullable().optional(),
  }),
  variants: z.object({
    mode: z.enum(['matrix', 'list', 'paste']),
    axes: z.array(attributeAxisInputSchema).max(4),
    patterns: z.object({ name: z.string().max(120), key: z.string().max(120), sku: z.string().max(120).nullable() }),
    rows: z
      .array(
        z.object({
          comboKey: z.string().max(200),
          include: z.boolean(),
          name: z.string().trim().min(1).max(80),
          key: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{0,15}$/, 'Use up to 16 letters, numbers or dashes.'),
          sku: z.string().trim().max(64).nullable(),
          defaultQty: qtyText.nullable(),
          unitPrice: priceText.nullable(),
          coreItemId: idText.nullable().optional(),
        }),
      )
      .max(200),
    manual: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(80),
          key: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{0,15}$/, 'Use up to 16 letters, numbers or dashes.'),
          sku: z.string().trim().max(64).nullable(),
          defaultQty: qtyText.nullable(),
          unitPrice: priceText.nullable(),
        }),
      )
      .max(200),
  }),
  priceCard: z.object({
    later: z.boolean(),
    effectiveFrom: date,
    lines: z.array(cardLineInputSchema).max(250),
    rules: z.array(rateRuleInputSchema).max(120),
    oneTime: z.array(z.object({ label: z.string().trim().min(1).max(80), amountCents: positiveCentsText, chargeOn: date })).max(20),
  }),
  schedule: z.object({
    enabled: z.boolean(),
    name: z.string().trim().max(80),
    pattern: schedulePatternSchema,
    days: weekdays,
    intervalWeeks: z.number().int().min(1).max(12),
    startsOn: date,
    endsOn: date.nullable(),
    leadDays: z.number().int().min(0).max(60),
    lines: z.array(z.object({ variantKey: z.string().trim().min(1).max(16), qty: qtyText, qtyByWeekday: z.record(z.string().regex(/^[0-6]$/), qtyText).nullable().optional(), assigneeId: idText.nullable().optional() })).max(200),
    defaultAssigneeId: idText.nullable().optional(),
  }),
  links: z.object({
    crmDealId: z.string().max(64).nullable().optional(),
    crmAccountId: z.string().max(64).nullable().optional(),
    pulseJobId: idText.nullable().optional(),
    createPulseJob: z.boolean().optional(),
    projectIds: z.array(idText).max(20).optional(),
    members: z.array(z.object({ userId: idText, role: z.enum(['owner', 'editor', 'commenter', 'viewer']) })).max(100).optional(),
  }),
});
export type ProgramWizardPayload = z.infer<typeof programWizardPayloadSchema>;

export const programTemplatePayloadSchema = z.object({
  kind: z.literal('program'),
  version: z.literal(1),
  settings: z.object({
    unitSingular: z.string().min(1).max(24),
    unitPlural: z.string().min(1).max(24),
    buildTitlePattern: z.string().min(1).max(120),
    autoStartOnOutput: z.boolean(),
    autoDoneWhenFull: z.boolean(),
    moneyMinRole: z.enum(['owner', 'editor', 'commenter', 'viewer']),
    hourlyTimeBasis: z.enum(['billable', 'all']),
    remindAt: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    workingDays: weekdays.nullable(),
  }),
  attributes: z.array(attributeAxisInputSchema).max(4),
  variants: z
    .array(
      z.object({
        key: z.string().max(16),
        name: z.string().max(80),
        sku: z.string().max(64).nullable(),
        attributes: z.record(z.string(), z.string()),
        defaultQty: qtyText.nullable(),
        packQty: qtyText.nullable(),
        stdMinutesPerUnit: z.string().nullable(),
      }),
    )
    .max(200),
  card: z.object({ lines: z.array(cardLineInputSchema).max(250), rules: z.array(rateRuleInputSchema).max(120) }).nullable(),
  oneTime: z.array(z.object({ label: z.string().max(80), amountCents: positiveCentsText, offsetDays: z.number().int().min(0).max(3650) })).max(20),
  schedules: z
    .array(
      z.object({
        name: z.string().max(80),
        pattern: schedulePatternSchema,
        days: weekdays,
        intervalWeeks: z.number().int().min(1).max(12),
        startOffsetDays: z.number().int().min(0).max(3650),
        endOffsetDays: z.number().int().min(0).max(3650).nullable(),
        leadDays: z.number().int().min(0).max(60),
        lines: z.array(z.object({ variantKey: z.string().max(16), qty: qtyText, qtyByWeekday: z.record(z.string(), qtyText).nullable() })).max(200),
      }),
    )
    .max(10),
});
export type ProgramTemplatePayload = z.infer<typeof programTemplatePayloadSchema>;

export const outputEntrySchema = z.union([
  z.object({
    buildId: idText,
    mode: z.enum(['add', 'set']),
    qty: qtyText,
    scrapQty: qtyText.optional(),
    note: z.string().trim().max(500).optional(),
    markDone: z.boolean().optional(),
    expectedVersion: z.number().int().min(1).nullable().optional(),
  }),
  z.object({
    newBuild: z.object({ variantId: idText.nullable(), title: z.string().trim().max(200).optional() }),
    qty: qtyText,
    scrapQty: qtyText.optional(),
    note: z.string().trim().max(500).optional(),
    markDone: z.boolean().optional(),
  }),
]);
export type OutputEntryInput = z.infer<typeof outputEntrySchema>;

export const endOfDaySchema = z.object({
  decisions: z
    .array(
      z.object({
        buildId: idText,
        action: z.enum(['close_short', 'move_rest', 'leave_open']),
        reason: z.string().trim().max(500).optional(),
        toDate: date.optional(),
      }),
    )
    .max(500),
});

export const logOutputInputSchema = z
  .object({
    date,
    entries: z.array(outputEntrySchema).max(500),
    endOfDay: endOfDaySchema.optional(),
  })
  .superRefine((value, issue) => {
    value.endOfDay?.decisions.forEach((decision, index) => {
      if (decision.action === 'close_short' && !decision.reason) {
        issue.addIssue({ code: 'custom', path: ['endOfDay', 'decisions', index, 'reason'], message: 'Say why the build closed short.' });
      }
    });
  });
export type LogOutputInput = z.infer<typeof logOutputInputSchema>;

/** Integer cents from a decimal string, for code that only compares (never for money math). */
export function centsTextOk(value: string): boolean {
  return centsText.safeParse(value).success;
}
