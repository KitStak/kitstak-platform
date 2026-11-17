/**
 * DTOs shared by the server domain layer, /api/v1 and the client. Timestamps are ISO strings,
 * dates are YYYY-MM-DD strings, money is integer cents (null when hidden from the reader).
 */
import type { OrgRole, PulseRole } from './permissions';

export interface PersonRef {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
}

/** An org member (people pickers, owners, assignees). */
export interface OrgPerson extends PersonRef {
  readonly orgRole: OrgRole;
  readonly title: string | null;
}

export interface OrgRef {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logo: string | null;
  readonly role: OrgRole;
}

export interface ModuleFlagsDTO {
  readonly crm: boolean;
  readonly wms: boolean;
  readonly projects: boolean;
  readonly pulse: boolean;
}

/** Which sibling apps Pulse can read for this org (licensed and their tables exist). */
export interface IntegrationAvailabilityDTO {
  readonly crm: boolean;
  readonly wms: boolean;
  readonly projects: boolean;
}

/** `GET /api/v1/me`. */
export interface MeResponse {
  readonly user: PersonRef;
  readonly org: OrgRef;
  readonly orgRole: OrgRole;
  readonly orgs: readonly OrgRef[];
  readonly pulseRole: PulseRole;
  readonly seesMoney: boolean;
  readonly seesWages: boolean;
  readonly modules: ModuleFlagsDTO;
  readonly integrations: IntegrationAvailabilityDTO;
}

/* ------------------------------------------------------------------------------------------
 * Wire rules (docs/pulse/SPEC.md section 2): cents are JS numbers (checked safe integers),
 * quantities, hours, per unit prices and paces are decimal strings, percents are basis points.
 * When the reader may not see money, every money and margin field is `null` and the DTO says
 * `moneyHidden: true`.
 * ---------------------------------------------------------------------------------------- */
import type {
  AlertEntityType,
  AlertKind,
  AlertSeverity,
  AlertStatus,
  ConfidenceValue,
  CostCategory,
  CostScope,
  DayReviewStatus,
  IndirectReason,
  JobKindValue,
  JobModeValue,
  JobStatusValue,
  LaborClassKind,
  LinkTargetType,
  MaterialMethodValue,
  PartsOwnerValue,
  PlanKind,
  PlanLineCategory,
  PlanLineUnit,
  PlanOrigin,
  PricingModelValue,
  ProfitGroup,
  PulseStatus,
  SavedViewPage,
  SharedCostRuleValue,
  SharedSpreadValue,
  StandardBasis,
  StoredRevenueKind,
  StreamSource,
  TargetMetric,
  TargetScope,
  VasBilling,
} from './constants';

/** Decimal number as text ("92.50"), exact. */
export type DecimalString = string;
/** Whole cents, or null when the reader may not see money. */
export type MoneyCents = number | null;

export interface SettingsDTO {
  readonly currency: string;
  readonly timezone: string;
  readonly weekStart: number;
  readonly fiscalYearStartMonth: number;
  readonly workingDays: readonly number[];
  readonly defaultShiftHours: DecimalString;
  readonly defaultPayrollTaxBp: number;
  readonly defaultBenefitsBp: number;
  readonly defaultOtherBurdenBp: number;
  readonly defaultOverheadPerHourCents: MoneyCents;
  readonly defaultOvertimeMultiplier: DecimalString;
  readonly defaultLoadedRateCents: MoneyCents;
  readonly defaultTargetMarginBp: number;
  readonly marginFloorBp: number;
  readonly atRiskGapBp: number;
  readonly laborWatchOverBp: number;
  readonly laborRiskOverBp: number;
  readonly productivityWatchBp: number;
  readonly productivityRiskBp: number;
  readonly materialWatchOverBp: number;
  readonly noEntryDays: number;
  readonly unbilledAlertCents: MoneyCents;
  readonly unbilledAlertDays: number;
  readonly sharedCostRule: SharedCostRuleValue;
  readonly sharedPctBp: number;
  readonly sharedSpread: SharedSpreadValue;
  readonly defaultPartsOwner: PartsOwnerValue;
  readonly defaultMemberRole: PulseRole;
  readonly jobNumberPrefix: string;
  readonly dateOrder: 'MDY' | 'DMY';
  readonly wmsAutoCreateJobs: boolean;
  readonly wmsSyncMaterials: boolean;
  readonly wmsSyncVas: boolean;
  readonly wmsSyncBilling: boolean;
  readonly wmsBillingOpsInProfit: readonly string[];
  readonly crmSuggestJobs: boolean;
  readonly projectsTimeImport: boolean;
  readonly recalcStartedAt: string | null;
  readonly onboarding: Readonly<Record<string, unknown>>;
  readonly sampleLoadedAt: string | null;
  readonly moneyHidden: boolean;
}

/** A person and their Pulse role (People and roles). */
export interface MemberRoleDTO extends PersonRef {
  readonly orgRole: OrgRole;
  readonly role: PulseRole;
  /** Which step of the resolver decided the role. `explicit` is a row an admin set. */
  readonly source: 'explicit' | 'wms' | 'org';
  /** The per person switch (only matters for supervisors and viewers). */
  readonly seesMoneySwitch: boolean;
  readonly seesMoney: boolean;
  readonly seesWages: boolean;
  readonly hasKioskPin: boolean;
}

/** `whoRunsPulse`: is there an owner yet, and may this person take the job? */
export interface RunPulseDTO {
  readonly hasOwner: boolean;
  readonly canClaim: boolean;
  readonly ownerNames: readonly string[];
}

export interface SiteDTO {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly timezone: string;
  readonly isDefault: boolean;
  readonly wmsWarehouseId: string | null;
  readonly archivedAt: string | null;
  /** Today in this site's time zone. */
  readonly today: string;
}

export interface ClientDTO {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: 'active' | 'inactive';
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly phone: string | null;
  readonly targetMarginBp: number | null;
  readonly paymentTermsDays: number | null;
  readonly partsOwner: PartsOwnerValue | null;
  readonly notes: string | null;
  readonly color: string | null;
  readonly coreCustomerId: string | null;
  readonly crmAccountItemId: string | null;
  readonly source: StreamSource;
  readonly isSample: boolean;
  readonly version: number;
  readonly jobCount?: number;
  readonly openJobCount?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export interface JobTypeDTO {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly unitLabel: string;
  readonly defaultPricingModel: PricingModelValue;
  readonly defaultLaborClassId: string | null;
  readonly defaultStandardUph: DecimalString | null;
  readonly targetMarginBp: number | null;
  readonly color: string | null;
  readonly icon: string | null;
  readonly position: number;
  readonly isBuiltin: boolean;
  readonly archivedAt: string | null;
}

export interface LaborClassDTO {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: LaborClassKind;
  readonly isDefault: boolean;
  readonly color: string | null;
  readonly archivedAt: string | null;
  /** Real cost of an hour today (all sites row), null when hidden or when no rate exists. */
  readonly currentLoadedRateCents: MoneyCents;
  readonly hasRate: boolean;
}

/** A dated rate row. Wage, taxes, benefits and overhead need `wage:read`; the loaded rates need `money:read`. */
export interface LaborRateDTO {
  readonly id: string;
  readonly laborClassId: string;
  readonly siteId: string | null;
  readonly effectiveFrom: string;
  readonly wageCents: MoneyCents;
  readonly payrollTaxBp: number | null;
  readonly benefitsBp: number | null;
  readonly otherBurdenBp: number | null;
  readonly overheadPerHourCents: MoneyCents;
  readonly overtimeMultiplier: DecimalString;
  readonly loadedRateCents: MoneyCents;
  readonly overtimeRateCents: MoneyCents;
  readonly billRateCents: MoneyCents;
  readonly note: string | null;
  readonly version: number;
  readonly wagesHidden: boolean;
  readonly moneyHidden: boolean;
}

/** What a rate change would do before it is saved (SPEC 4.3). */
export interface RateChangePreviewDTO {
  readonly entries: number;
  readonly jobs: number;
  readonly closedEntries: number;
  /** New labor cost minus old labor cost over the open entries. Above zero lowers profit. */
  readonly laborDeltaCents: MoneyCents;
}

export interface ItemDTO {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly uom: string;
  readonly unitCost: DecimalString | null;
  readonly suppliedBy: PartsOwnerValue | null;
  readonly clientId: string | null;
  readonly wmsProductId: string | null;
  readonly version: number;
  readonly moneyHidden: boolean;
}

export interface VasServiceDTO {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly unitLabel: string;
  readonly billing: VasBilling;
  readonly defaultPrice: DecimalString | null;
  readonly defaultCostPerUnit: DecimalString | null;
  readonly standardUph: DecimalString | null;
  readonly defaultLaborClassId: string | null;
  readonly wmsVasTypeId: string | null;
  readonly color: string | null;
  readonly active: boolean;
  readonly version: number;
  readonly moneyHidden: boolean;
}

export interface StandardDTO {
  readonly id: string;
  readonly jobTypeId: string | null;
  readonly clientId: string | null;
  readonly vasServiceId: string | null;
  readonly laborClassId: string | null;
  readonly unitsPerLaborHour: DecimalString;
  readonly effectiveFrom: string;
  readonly basis: StandardBasis;
  readonly note: string | null;
  readonly version: number;
}

export interface TargetDTO {
  readonly id: string;
  readonly scope: TargetScope;
  readonly scopeId: string | null;
  readonly metric: TargetMetric;
  /** First day of the month, or null for every month. */
  readonly periodMonth: string | null;
  /** Null when the goal is a money goal and the reader may not see money. */
  readonly value: DecimalString | null;
  readonly version: number;
}

export interface UsualCrewLineDTO {
  readonly laborClassId: string;
  readonly headcount: number;
}

export interface JobDTO {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly clientCode: string;
  readonly jobTypeId: string;
  readonly jobTypeName: string;
  readonly siteId: string;
  readonly siteName: string;
  readonly kind: JobKindValue;
  readonly status: JobStatusValue;
  readonly pricingModel: PricingModelValue;
  readonly unitLabel: string;
  readonly plannedUnits: DecimalString;
  readonly unitPrice: DecimalString | null;
  readonly fixedPriceCents: MoneyCents;
  readonly billRateCents: MoneyCents;
  readonly materialMethod: MaterialMethodValue;
  readonly materialCostPerUnit: DecimalString | null;
  readonly partsOwner: PartsOwnerValue | null;
  readonly defaultLaborClassId: string | null;
  readonly usualCrew: readonly UsualCrewLineDTO[];
  readonly standardUph: DecimalString | null;
  readonly targetMarginBp: number | null;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly completedDate: string | null;
  readonly poNumber: string | null;
  readonly ownerId: string | null;
  readonly description: string | null;
  readonly kitSku: string | null;
  readonly kitName: string | null;
  readonly wmsShortage: boolean;
  readonly pinnedNote: string | null;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly source: StreamSource;
  readonly isSample: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly moneyHidden: boolean;
}

/** One reason behind a status, as stored: numbers and ids only (SPEC section 3). */
export interface RiskReasonDTO {
  readonly rule: string;
  readonly params: Readonly<Record<string, string | number | null>>;
  /** How much it moves projected profit (0 or less). Null when money is hidden. */
  readonly impactCents: MoneyCents;
  readonly nextStep: string | null;
  /** The words on the next step button. */
  readonly nextStepLabel: string | null;
  /** The reason in words for this reader. */
  readonly text: string;
}

export interface JobStatsDTO {
  readonly unitsGood: DecimalString;
  readonly unitsScrap: DecimalString;
  readonly unitsRework: DecimalString;
  readonly hours: DecimalString;
  readonly overtimeHours: DecimalString;
  readonly setupHours: DecimalString;
  readonly paceHours: DecimalString;
  readonly evidenceDays: number;
  readonly revenueCents: MoneyCents;
  readonly baseRevenueCents: MoneyCents;
  readonly vasRevenueCents: MoneyCents;
  readonly otherRevenueCents: MoneyCents;
  readonly billedCents: MoneyCents;
  readonly notBilledYetCents: MoneyCents;
  readonly laborCents: MoneyCents;
  readonly materialCents: MoneyCents;
  readonly scrapCents: MoneyCents;
  readonly otherCents: MoneyCents;
  readonly sharedCents: MoneyCents;
  readonly costCents: MoneyCents;
  readonly profitCents: MoneyCents;
  readonly marginBp: number | null;
  readonly marginBeforeSharedBp: number | null;
  readonly uph: DecimalString | null;
  readonly standardUph: DecimalString | null;
  readonly productivityBp: number | null;
  readonly pctCompleteBp: number | null;
  readonly targetMarginBp: number | null;
  readonly mode: JobModeValue | null;
  readonly costAtFinishCents: MoneyCents;
  readonly revenueAtFinishCents: MoneyCents;
  readonly projectedProfitCents: MoneyCents;
  readonly projectedMarginBp: number | null;
  readonly projectedLaborHours: DecimalString | null;
  readonly projectedFinishDate: string | null;
  readonly paceUph: DecimalString | null;
  readonly paceWeightBp: number | null;
  readonly confidence: ConfidenceValue | null;
  readonly riskStatus: PulseStatus | null;
  readonly riskReasons: readonly RiskReasonDTO[];
  /** The one line next to the status pill, in words for this reader. Empty when the job has no status. */
  readonly headline: string;
  /** Things to fix. `laborMissing` marks profit as "Not complete yet". */
  readonly needs: Readonly<Record<string, unknown>>;
  readonly laborMissing: boolean;
  readonly firstEntryDate: string | null;
  readonly lastEntryDate: string | null;
  readonly entryCount: number;
  readonly computedAt: string | null;
  readonly moneyHidden: boolean;
}

export interface JobListItemDTO extends JobDTO {
  readonly stats: JobStatsDTO;
  /** Labor hours of the plan in use (budget, else quote). */
  readonly planLaborHours: DecimalString | null;
}

export interface JobPriceDTO {
  readonly id: string;
  readonly jobId: string;
  readonly effectiveFrom: string;
  readonly unitPrice: DecimalString | null;
  readonly billRateCents: MoneyCents;
  readonly materialCostPerUnit: DecimalString | null;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface JobPlanLineDTO {
  readonly id: string;
  readonly position: number;
  readonly category: PlanLineCategory;
  readonly description: string | null;
  readonly quantity: DecimalString | null;
  readonly unit: PlanLineUnit | null;
  readonly unitAmount: DecimalString | null;
  readonly amountCents: MoneyCents;
  readonly flex: boolean | null;
  readonly laborClassId: string | null;
  readonly vasServiceId: string | null;
  readonly itemId: string | null;
}

export interface JobPlanDTO {
  readonly id: string;
  readonly jobId: string;
  readonly plan: PlanKind;
  readonly units: DecimalString;
  readonly revenueCents: MoneyCents;
  readonly laborHours: DecimalString;
  readonly laborCents: MoneyCents;
  readonly setupHours: DecimalString;
  readonly setupCents: MoneyCents;
  readonly materialCents: MoneyCents;
  readonly otherCents: MoneyCents;
  readonly sharedCents: MoneyCents;
  readonly sharedAuto: boolean;
  readonly version: number;
  readonly origin: PlanOrigin;
  readonly originRef: string | null;
  readonly note: string | null;
  readonly lines: readonly JobPlanLineDTO[];
  readonly updatedAt: string;
  readonly moneyHidden: boolean;
}

export interface JobLinkDTO {
  readonly id: string;
  readonly jobId: string;
  readonly targetType: LinkTargetType;
  readonly targetId: string;
  readonly importsTime: boolean;
  readonly title: string | null;
  readonly status: string | null;
  /** Full URL into the sibling app (host added at read time), or null. */
  readonly url: string | null;
}

export interface JobDetailDTO extends JobListItemDTO {
  readonly prices: readonly JobPriceDTO[];
  readonly quote: JobPlanDTO | null;
  readonly budget: JobPlanDTO | null;
  readonly links: readonly JobLinkDTO[];
  readonly owner: PersonRef | null;
}

interface StreamRowBase {
  readonly id: string;
  readonly siteId: string | null;
  readonly source: StreamSource;
  readonly sourceRef: string | null;
  readonly isSample: boolean;
  readonly version: number;
  readonly note: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  /** True when the row sits in a closed month and cannot change. */
  readonly locked: boolean;
  readonly moneyHidden: boolean;
}

export interface ProductionEntryDTO extends StreamRowBase {
  readonly siteId: string;
  readonly jobId: string;
  readonly jobNumber: string;
  readonly jobName: string;
  readonly workDate: string;
  readonly shift: string;
  readonly laborClassId: string | null;
  readonly unitsGood: DecimalString;
  readonly unitsScrap: DecimalString;
  readonly unitsRework: DecimalString;
  readonly headcount: DecimalString | null;
  /** Total labor hours (people times hours each). */
  readonly hours: DecimalString;
  readonly overtimeHours: DecimalString;
  readonly setupHours: DecimalString;
  readonly hoursConfirmed: boolean;
  readonly rateCents: MoneyCents;
  readonly overtimeRateCents: MoneyCents;
  readonly laborCostCents: MoneyCents;
  readonly sharedCents: MoneyCents;
  readonly baseRevenueCents: MoneyCents;
  readonly stdMaterialCents: MoneyCents;
  readonly stdScrapCents: MoneyCents;
  readonly needsRate: boolean;
  readonly enteredBy: string | null;
}

export interface IndirectEntryDTO extends StreamRowBase {
  readonly siteId: string;
  readonly workDate: string;
  readonly laborClassId: string | null;
  readonly reason: IndirectReason;
  readonly headcount: DecimalString | null;
  readonly hours: DecimalString;
  readonly overtimeHours: DecimalString;
  readonly rateCents: MoneyCents;
  readonly costCents: MoneyCents;
  readonly needsRate: boolean;
}

export interface PaidHoursDTO extends StreamRowBase {
  readonly siteId: string;
  readonly workDate: string;
  readonly laborClassId: string | null;
  readonly paidHours: DecimalString;
  readonly paidCents: MoneyCents;
}

export interface MaterialUsageDTO extends StreamRowBase {
  readonly siteId: string;
  readonly jobId: string;
  readonly usageDate: string;
  readonly itemId: string | null;
  readonly itemSku: string | null;
  readonly itemName: string | null;
  readonly quantityUsed: DecimalString;
  readonly quantityScrapped: DecimalString;
  readonly quantityPlanned: DecimalString | null;
  readonly unitCost: DecimalString | null;
  readonly uom: string | null;
  readonly lot: string | null;
  readonly suppliedBy: PartsOwnerValue | null;
  readonly resolvedSuppliedBy: PartsOwnerValue;
  readonly costCents: MoneyCents;
  readonly scrapCents: MoneyCents;
}

export interface CostEntryDTO extends StreamRowBase {
  readonly scope: CostScope;
  readonly jobId: string | null;
  readonly clientId: string | null;
  readonly costDate: string;
  readonly category: CostCategory;
  readonly amountCents: MoneyCents;
  readonly vendor: string | null;
  readonly reference: string | null;
}

export interface RevenueEntryDTO extends StreamRowBase {
  readonly siteId: string;
  readonly jobId: string | null;
  readonly clientId: string;
  readonly revenueDate: string;
  readonly kind: StoredRevenueKind;
  readonly description: string | null;
  readonly quantity: DecimalString | null;
  readonly unitPrice: DecimalString | null;
  readonly amountCents: MoneyCents;
  readonly invoiceNumber: string | null;
  readonly vasServiceId: string | null;
  readonly serviceLabel: string | null;
  readonly approved: boolean;
}

export interface VasEntryDTO extends StreamRowBase {
  readonly siteId: string;
  readonly vasServiceId: string;
  readonly clientId: string;
  readonly jobId: string | null;
  readonly workDate: string;
  readonly quantity: DecimalString;
  readonly unitPrice: DecimalString | null;
  /** Null means "No price set yet" (and also null when money is hidden: check `moneyHidden`). */
  readonly amountCents: MoneyCents;
  readonly noPrice: boolean;
  readonly laborClassId: string | null;
  readonly headcount: DecimalString | null;
  readonly hours: DecimalString;
  readonly overtimeHours: DecimalString;
  readonly materialCents: MoneyCents;
  readonly laborCostCents: MoneyCents;
  readonly sharedCents: MoneyCents;
  readonly needsRate: boolean;
}

/** One job on the Log work day grid, with its crew lines for the day. */
export interface LogGridRowDTO {
  readonly jobId: string;
  readonly jobNumber: string;
  readonly jobName: string;
  readonly clientName: string;
  readonly unitLabel: string;
  readonly status: JobStatusValue;
  readonly defaultLaborClassId: string | null;
  readonly usualCrew: readonly UsualCrewLineDTO[];
  /** Target pace for this job on this date, null when there is none. */
  readonly targetUph: DecimalString | null;
  readonly plannedUnits: DecimalString;
  readonly unitsDone: DecimalString;
  readonly entries: readonly ProductionEntryDTO[];
}

export interface DayReviewDTO {
  readonly siteId: string;
  readonly workDate: string;
  readonly status: DayReviewStatus;
  readonly flags: readonly Readonly<Record<string, unknown>>[];
  readonly markedBy: string | null;
  readonly markedAt: string | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly note: string | null;
}

export interface LogGridDTO {
  readonly date: string;
  readonly siteId: string;
  readonly today: string;
  readonly shiftHours: DecimalString;
  readonly rows: readonly LogGridRowDTO[];
  readonly indirect: readonly IndirectEntryDTO[];
  readonly paid: readonly PaidHoursDTO[];
  readonly review: DayReviewDTO | null;
  /** The month of this date is closed. */
  readonly monthClosed: boolean;
  /** This reader may change the day (role, 7 day window, day not marked complete). */
  readonly canEdit: boolean;
  readonly lockedReason: string | null;
  readonly totals: { readonly unitsGood: DecimalString; readonly hours: DecimalString; readonly indirectHours: DecimalString; readonly paidHours: DecimalString };
}

/** Result of saving one grid row: the fresh row and the job numbers people watch while typing. */
export interface SaveProductionResult {
  readonly entry: ProductionEntryDTO;
  readonly created: boolean;
}

/** One row of the Profit explorer, or a total. */
export interface ProfitRowDTO {
  readonly key: string;
  readonly label: string;
  readonly sublabel: string | null;
  readonly revenueCents: MoneyCents;
  readonly baseRevenueCents: MoneyCents;
  readonly vasRevenueCents: MoneyCents;
  readonly otherRevenueCents: MoneyCents;
  readonly laborCents: MoneyCents;
  readonly materialCents: MoneyCents;
  readonly otherCents: MoneyCents;
  readonly sharedCents: MoneyCents;
  readonly costCents: MoneyCents;
  readonly profitCents: MoneyCents;
  readonly marginBp: number | null;
  readonly marginBeforeSharedBp: number | null;
  readonly laborPctBp: number | null;
  readonly billedCents: MoneyCents;
  readonly unitsGood: DecimalString;
  readonly unitsScrap: DecimalString;
  readonly hours: DecimalString;
  /** Units over all labor hours of the group (the job page uses counted days instead). */
  readonly uph: DecimalString | null;
  readonly costPerUnitCents: MoneyCents;
  readonly profitPerUnitCents: MoneyCents;
  readonly jobCount: number;
  /** The same numbers for the period right before, when asked for. */
  readonly prior: { readonly revenueCents: MoneyCents; readonly profitCents: MoneyCents; readonly marginBp: number | null; readonly unitsGood: DecimalString } | null;
  /** Profit per bucket for the sparkline (null entries when money is hidden use units). */
  readonly trend: readonly number[] | null;
  /** A job in the group has units with no hours or hours with no rate. */
  readonly laborMissing: boolean;
  readonly riskStatus: PulseStatus | null;
}

export interface ProfitResponse {
  readonly by: ProfitGroup;
  readonly from: string;
  readonly to: string;
  readonly rows: readonly ProfitRowDTO[];
  readonly total: ProfitRowDTO;
  readonly moneyHidden: boolean;
}

export interface ProfitFilters {
  readonly from: string;
  readonly to: string;
  readonly siteId?: string | null;
  readonly clientId?: string | null;
  readonly jobTypeId?: string | null;
  readonly jobId?: string | null;
  readonly vasServiceId?: string | null;
  readonly status?: JobStatusValue | null;
}

/** The walk from profit on jobs to company profit (SPEC 4.9). */
export interface CompanyBridgeDTO {
  readonly from: string;
  readonly to: string;
  readonly workProfitCents: MoneyCents;
  readonly sharedGapCents: MoneyCents;
  readonly missingCostCents: MoneyCents;
  readonly companyCostCents: MoneyCents;
  readonly overheadAbsorbedCents: MoneyCents;
  /** Null when no company costs were entered (the line is hidden). */
  readonly overheadGapCents: MoneyCents;
  readonly companyProfitCents: MoneyCents;
  readonly indirectCents: MoneyCents;
  readonly sharedAppliedCents: MoneyCents;
  readonly directHours: DecimalString;
  readonly indirectHours: DecimalString;
  readonly paidHours: DecimalString;
  readonly missingHours: DecimalString;
  readonly utilizationBp: number | null;
  readonly paidCents: MoneyCents;
  readonly grossPayCents: MoneyCents;
  readonly payrollGapCents: MoneyCents;
  readonly overLoggedDays: number;
  readonly hasCompanyCosts: boolean;
  readonly moneyHidden: boolean;
}

export interface TrendPointDTO {
  readonly bucket: string;
  readonly revenueCents: MoneyCents;
  readonly costCents: MoneyCents;
  readonly profitCents: MoneyCents;
  readonly marginBp: number | null;
  readonly unitsGood: DecimalString;
  readonly hours: DecimalString;
}

/** `GET /api/v1/summary`. */
export interface SummaryDTO {
  readonly from: string;
  readonly to: string;
  readonly openJobs: number;
  readonly atRisk: number;
  readonly losing: number;
  readonly headsUp: number;
  readonly onTrack: number;
  readonly noData: number;
  readonly total: ProfitRowDTO;
  readonly prior: ProfitRowDTO | null;
  readonly bridge: CompanyBridgeDTO;
  readonly entryProgress: { readonly activeJobs: number; readonly loggedToday: number; readonly date: string; readonly daysReviewedThisWeek: number; readonly workDaysThisWeek: number };
  readonly notBilledYetCents: MoneyCents;
  readonly openAlerts: number;
  readonly thingsToFix: { readonly needsRate: number; readonly noPrice: number; readonly unitsNoHours: number; readonly serviceNoPrice: number };
  readonly moneyHidden: boolean;
}

export interface PeriodDTO {
  readonly periodMonth: string;
  readonly status: 'open' | 'closed';
  readonly closedAt: string | null;
  readonly closedBy: string | null;
  readonly reopenedAt: string | null;
  readonly reopenedBy: string | null;
  readonly reopenReason: string | null;
  readonly snapshot: Readonly<Record<string, unknown>> | null;
  readonly checklist: Readonly<Record<string, unknown>> | null;
}

/** What closing a month would check (SPEC 4.16). */
export interface CloseChecklistDTO {
  readonly periodMonth: string;
  readonly entriesNeedingRate: number;
  readonly daysWithUnitsNoHours: number;
  readonly servicesNoPrice: number;
  readonly daysNotReviewed: number;
  readonly payrollGapCents: MoneyCents;
  readonly ready: boolean;
}

export interface AlertRuleDTO {
  readonly id: string;
  readonly name: string;
  readonly kind: AlertKind;
  readonly threshold: DecimalString | null;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly severity: AlertSeverity;
  readonly notifyRoles: readonly string[];
  readonly notifyUserIds: readonly string[];
  readonly enabled: boolean;
  readonly isSystem: boolean;
}

export interface AlertDTO {
  readonly id: string;
  readonly ruleId: string | null;
  readonly kind: string;
  readonly severity: AlertSeverity;
  readonly entityType: AlertEntityType;
  readonly entityId: string | null;
  readonly entityLabel: string | null;
  readonly title: string;
  readonly body: string;
  readonly nextStep: string | null;
  readonly impactCents: MoneyCents;
  readonly url: string | null;
  readonly status: AlertStatus;
  readonly snoozedUntil: string | null;
  readonly assignedTo: string | null;
  readonly resolvedAt: string | null;
  readonly resolution: 'cleared' | 'manual' | null;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly pmTaskId: string | null;
  readonly moneyHidden: boolean;
}

export interface NotificationDTO {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly url: string | null;
  readonly alertId: string | null;
  readonly jobId: string | null;
  readonly readAt: string | null;
  readonly createdAt: string;
}

export interface SavedViewDTO {
  readonly id: string;
  readonly userId: string | null;
  readonly page: SavedViewPage;
  readonly name: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly shared: boolean;
  readonly isDefault: boolean;
  readonly position: number;
  readonly mine: boolean;
}

export interface ActivityDTO {
  readonly id: string;
  readonly actor: PersonRef | null;
  readonly actorKind: string;
  readonly verb: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly jobId: string | null;
  readonly clientId: string | null;
  readonly field: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly body: string | null;
  readonly createdAt: string;
}

/** Cursor page (`nextCursor` is null on the last page). */
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface UserPrefsDTO {
  readonly defaultSiteId?: string | null;
  readonly defaultRange?: string | null;
  readonly logColumns?: readonly string[];
  readonly pinnedJobIds?: readonly string[];
  readonly recentJobIds?: readonly string[];
  readonly hiddenTips?: readonly string[];
  readonly notify?: Readonly<Record<string, boolean>>;
  readonly digest?: boolean;
  readonly [key: string]: unknown;
}

/** Sidebar and bell badges. */
export interface BadgesDTO {
  readonly jobsAtRisk: number;
  readonly openAlerts: number;
  readonly unreadNotifications: number;
}

export interface JobListFilters {
  readonly tab?: 'open' | 'all' | 'completed' | 'planned';
  readonly q?: string | null;
  readonly clientId?: string | null;
  readonly jobTypeId?: string | null;
  readonly siteId?: string | null;
  readonly ownerId?: string | null;
  readonly status?: readonly JobStatusValue[];
  readonly risk?: readonly PulseStatus[];
  readonly includeArchived?: boolean;
  readonly includeDeleted?: boolean;
  readonly limit?: number;
}

/** One search hit for the command palette. */
export interface SearchHitDTO {
  readonly type: 'job' | 'client' | 'service';
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly href: string;
}

/** One stamped row behind a number (drill down, "See 14 entries"). */
export interface FactRowDTO {
  readonly workDate: string;
  readonly kind: 'revenue_base' | 'revenue_vas' | 'revenue_other' | 'labor' | 'material' | 'other' | 'shared' | 'billed_memo';
  readonly amountCents: MoneyCents;
  readonly unitsGood: DecimalString;
  readonly hours: DecimalString;
  readonly jobId: string | null;
  readonly clientId: string;
  readonly vasServiceId: string | null;
  /** The table and row the number came from. */
  readonly sourceTable: string;
  readonly sourceId: string;
}

/** "Suggest from history": median pace of the last evidence days, with the spread. */
export interface PaceSuggestionDTO {
  readonly median: DecimalString | null;
  readonly low: DecimalString | null;
  readonly high: DecimalString | null;
  readonly days: number;
  readonly jobs: number;
}

/** The rate that applies to an entry and where it came from. */
export interface RateForEntryDTO {
  readonly found: boolean;
  readonly source: 'class' | 'default' | 'none' | string;
  readonly rateCents: MoneyCents;
  readonly overtimeRateCents: MoneyCents;
  readonly laborClassId: string | null;
  readonly rateId: string | null;
}

/** The crew lines of the most recent earlier day of a job ("Copy yesterday's crew"). */
export interface PreviousCrewDTO {
  readonly jobId: string;
  readonly workDate: string;
  readonly lines: readonly { readonly laborClassId: string | null; readonly shift: string; readonly headcount: DecimalString | null; readonly hours: DecimalString }[];
}

export interface JobPlansDTO {
  readonly quote: JobPlanDTO | null;
  readonly budget: JobPlanDTO | null;
}

/** `GET /api/v1/labor/summary`: the Labor page (Time and Cost tabs). */
export interface LaborSummaryDTO {
  readonly from: string;
  readonly to: string;
  readonly byClass: readonly {
    readonly laborClassId: string | null;
    readonly name: string;
    readonly directHours: DecimalString;
    readonly indirectHours: DecimalString;
    readonly overtimeHours: DecimalString;
    readonly setupHours: DecimalString;
    readonly laborCents: MoneyCents;
    readonly indirectCents: MoneyCents;
    readonly unitsGood: DecimalString;
    readonly entries: number;
    readonly needsRate: number;
  }[];
  readonly byReason: readonly { readonly reason: string; readonly hours: DecimalString; readonly costCents: MoneyCents; readonly entries: number }[];
  readonly byDay: readonly {
    readonly date: string;
    readonly directHours: DecimalString;
    readonly indirectHours: DecimalString;
    readonly paidHours: DecimalString;
    readonly missingHours: DecimalString;
    readonly indirectCents: MoneyCents;
    readonly missingCents: MoneyCents;
    readonly overLogged: boolean;
  }[];
  readonly bridge: CompanyBridgeDTO;
  readonly moneyHidden: boolean;
}
