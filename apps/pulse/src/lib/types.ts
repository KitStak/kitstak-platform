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
  /** Wage burden defaults: null when the reader may not see wages (`wage:read`). */
  readonly defaultPayrollTaxBp: number | null;
  readonly defaultBenefitsBp: number | null;
  readonly defaultOtherBurdenBp: number | null;
  readonly defaultOverheadPerHourCents: MoneyCents;
  readonly defaultOvertimeMultiplier: DecimalString;
  readonly defaultLoadedRateCents: MoneyCents;
  /** Null when the reader may not see money. */
  readonly defaultTargetMarginBp: number | null;
  readonly marginFloorBp: number | null;
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
  /** How company costs are shared out over part of a month: by calendar day (the default) or by work day (4.9). */
  readonly companyCostSpread: 'calendar' | 'work_days';
  readonly defaultPartsOwner: PartsOwnerValue;
  readonly defaultMemberRole: PulseRole;
  readonly jobNumberPrefix: string;
  readonly dateOrder: 'MDY' | 'DMY';
  readonly wmsAutoCreateJobs: boolean;
  readonly wmsSyncMaterials: boolean;
  readonly wmsSyncVas: boolean;
  readonly wmsSyncBilling: boolean;
  /** "Let warehouse contract rates set job prices" (Connected apps). On by default. */
  readonly wmsContractPrices: boolean;
  readonly wmsBillingOpsInProfit: readonly string[];
  readonly crmSuggestJobs: boolean;
  readonly projectsTimeImport: boolean;
  readonly recalcStartedAt: string | null;
  readonly onboarding: Readonly<Record<string, unknown>>;
  readonly sampleLoadedAt: string | null;
  readonly moneyHidden: boolean;
  /** True when the wage burden defaults above are hidden. */
  readonly wagesHidden: boolean;
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

/** A job in the Deleted list: the job as it was, and who deleted it (`deletedAt` says when). */
export interface DeletedJobDTO extends JobListItemDTO {
  /** The person who deleted it, from the activity log. Null when the log has no name for it. */
  readonly deletedById: string | null;
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
  /**
   * Set when the price of this job came from the client's warehouse contract through this work
   * order: the contract's name and the day Pulse took the rate. No amounts, so every reader sees it.
   */
  readonly priceFromContract: { readonly contractName: string; readonly at: string | null } | null;
  /**
   * The warehouse contract behind this work order link, for the price dialog. `inEffect`: the price
   * in force on the job is the contract's (else a price typed in Pulse wins until the contract's
   * rates change). `billedBy`: only the warehouse bill can price the job (`tiers` or `conditions`).
   * `unitPrice` and `fixedPriceCents` are the contract's, null when money is hidden.
   */
  readonly contract?: {
    readonly contractName: string;
    readonly inEffect: boolean;
    readonly billedBy: 'tiers' | 'conditions' | null;
    readonly unitPrice: string | null;
    readonly fixedPriceCents: number | null;
    readonly moneyHidden: boolean;
  } | null;
}

export interface JobDetailDTO extends JobListItemDTO {
  readonly prices: readonly JobPriceDTO[];
  readonly quote: JobPlanDTO | null;
  readonly budget: JobPlanDTO | null;
  readonly links: readonly JobLinkDTO[];
  readonly owner: PersonRef | null;
  /**
   * Who buys the parts when the job itself does not say (`partsOwner` is null): the client's own
   * setting, then the workspace default. The same order the cost stamp uses.
   */
  readonly inheritedPartsOwner?: PartsOwnerValue;
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
  /**
   * Where a pulled entry came from: the warehouse record's page. Null for a typed entry, and null
   * when the workspace no longer has that app on its plan (show plain words, never a dead link).
   */
  readonly sourceUrl: string | null;
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
  /**
   * An extra service row with revenue and no cost of any kind (no hours, no parts). Pulse does not know
   * what the work cost, so `marginBp` is null and the screen says "No cost yet", never 100%.
   * Always false for a reader without money, and for rows that are not about an extra service.
   */
  readonly costMissing: boolean;
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
  /** Only rows put on a client with no job (the drill down behind "Put on a client, not on a job"). */
  readonly noJob?: boolean;
  /** Company profit only: share company costs by calendar day or by work day for this view. Left out: the workspace setting. */
  readonly companyCostSpread?: 'calendar' | 'work_days' | null;
}

/** The walk from profit on jobs to company profit (SPEC 4.9). */
export interface CompanyBridgeDTO {
  readonly from: string;
  readonly to: string;
  readonly workProfitCents: MoneyCents;
  readonly sharedGapCents: MoneyCents;
  readonly missingCostCents: MoneyCents;
  /**
   * Company costs counted for these days (SPEC 4.9). Company costs are monthly, so a part month counts
   * its share by calendar day or by work day (`companyCostSpread`) and a whole month counts all of it. Months with no company costs count nothing.
   */
  readonly companyCostCents: MoneyCents;
  /** Overhead the hourly rates covered on the days of the months that count company costs (all days when none do). */
  readonly overheadAbsorbedCents: MoneyCents;
  /** Null when no company costs were counted (the line is hidden). */
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
  /** True when company costs were counted, so the walk has the overhead step and the company number is "after overhead". */
  readonly hasCompanyCosts: boolean;
  /** True when the range is not whole calendar months of company costs: a part month, or a month with none typed in. */
  readonly companyCostPartial: boolean;
  /** Plain words to show beside the company number when it is partial, like "Company costs for 18 of 30 days." Never holds money. */
  readonly companyCostNote: string | null;
  /**
   * How a part month was shared out: `calendar` (every day carries a share, the default) or
   * `work_days` (only working days do). From `settings.companyCostSpread`, or the view's `spread`.
   */
  readonly companyCostSpread: 'calendar' | 'work_days';
  /** One row per calendar month that counted company costs, oldest first. */
  readonly companyCostParts: readonly {
    readonly month: string;
    readonly daysCounted: number;
    readonly daysInMonth: number;
    readonly workDaysCounted: number;
    readonly workDaysInMonth: number;
    /** `calendar` when the month was counted by calendar day, `work_days` by work day. */
    readonly spread: 'calendar' | 'work_days';
    readonly monthCostCents: MoneyCents;
    readonly countedCents: MoneyCents;
  }[];
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
  /** The line of the rule (dollars or a margin percent). Null when the rule has none, and for a reader without money. */
  readonly threshold: DecimalString | null;
  /** True when the reader may not see money: `threshold` is null and `name` holds no numbers. */
  readonly moneyHidden: boolean;
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
  /** `live`: the job's current figure, the same one Home and the job page show. `fired`: the figure from when the alert fired, because the job no longer has that reason. */
  readonly impactAsOf?: 'live' | 'fired';
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

/** One search hit for the command palette and `/search`. Never carries money. */
export interface SearchHitDTO {
  readonly type: 'job' | 'client' | 'jobType' | 'service';
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

/* ---------------------------------------------------------------- production team: device links, kiosk, punches, review, pace */

/** A link for a shared screen (floor tablet or wall TV). The secret part is shown once, when it is made. */
export interface DeviceLinkDTO {
  readonly id: string;
  readonly kind: 'wall' | 'kiosk';
  readonly name: string;
  readonly siteId: string;
  readonly siteName: string;
  /** First characters of the secret, so a person can tell links apart. */
  readonly tokenPrefix: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly expiresAt: string;
  readonly lastSeenAt: string | null;
  readonly revokedAt: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly status: 'active' | 'expired' | 'revoked';
}

export interface CreatedDeviceLinkDTO {
  readonly link: DeviceLinkDTO;
  /** The secret. Only returned by create and renew with a new secret. */
  readonly token: string;
  /** Path to open on the device, for example `/kiosk/t/<token>`. */
  readonly path: string;
}

export interface KioskPersonDTO {
  readonly id: string;
  readonly name: string;
}

/** What a floor tablet may know before anyone unlocks it. Never money. */
export interface KioskStateDTO {
  readonly linkName: string;
  readonly siteName: string;
  readonly today: string;
  readonly idleSeconds: number;
  readonly shiftHours: DecimalString;
  readonly people: readonly KioskPersonDTO[];
}

/** A job card on the floor tablet. Never money. */
export interface KioskJobDTO {
  readonly jobId: string;
  readonly jobNumber: string;
  readonly jobName: string;
  readonly clientName: string;
  readonly unitLabel: string;
  readonly targetUph: DecimalString | null;
  readonly plannedUnits: DecimalString;
  readonly unitsDone: DecimalString;
  readonly todayUnits: DecimalString;
  readonly todayHours: DecimalString;
  readonly usualPeople: number | null;
}

export interface KioskSessionDTO {
  readonly session: string;
  readonly expiresAt: string;
  readonly person: KioskPersonDTO;
  readonly jobs: readonly KioskJobDTO[];
}

export interface KioskSaveDTO {
  /** True when this entry was already saved earlier (a retry). Nothing was logged twice. */
  readonly duplicate: boolean;
  readonly jobId: string;
  readonly workDate: string;
  readonly todayUnits: DecimalString;
  readonly todayHours: DecimalString;
  readonly uph: DecimalString | null;
  readonly targetUph: DecimalString | null;
}

/** One time punch: a person, a day, and a job or a reason. */
export interface PunchDTO extends StreamRowBase {
  readonly siteId: string;
  readonly workDate: string;
  readonly employeeCode: string;
  /** Null for readers who may not see names (below manager). */
  readonly employeeName: string | null;
  readonly jobId: string | null;
  readonly jobNumber: string | null;
  readonly jobName: string | null;
  readonly reason: string | null;
  readonly laborClassId: string | null;
  readonly hours: DecimalString;
  readonly overtimeHours: DecimalString;
  readonly payCents: MoneyCents;
}

export interface PunchRollupDTO {
  readonly punches: number;
  readonly productionRows: number;
  readonly indirectRows: number;
  readonly paidRows: number;
}

/** One day in the review queue of a site. */
export interface DayQueueDTO {
  readonly siteId: string;
  readonly siteName: string;
  readonly date: string;
  readonly status: 'not_marked' | 'complete' | 'approved' | 'sent_back';
  readonly review: DayReviewDTO | null;
  /** Odd rows, computed fresh. Numbers and ids only. */
  readonly flags: readonly Readonly<Record<string, unknown>>[];
  /** Active jobs that were logged on the work day before but have nothing on this day. */
  readonly missingJobs: readonly { readonly jobId: string; readonly jobNumber: string; readonly jobName: string }[];
  readonly entries: number;
  readonly jobs: number;
  readonly unitsGood: DecimalString;
  readonly hours: DecimalString;
  readonly locked: boolean;
}

export interface PaceBoardRowDTO {
  readonly key: string;
  readonly label: string;
  readonly sublabel: string | null;
  readonly unitsGood: DecimalString;
  readonly paceHours: DecimalString;
  readonly uph: DecimalString | null;
  /** Target pace. For a labor class or a day it is the pace the same units needed at each job's target. */
  readonly targetUph: DecimalString | null;
  readonly productivityBp: number | null;
  readonly days: number;
}

export interface PaceBoardDTO {
  readonly from: string;
  readonly to: string;
  readonly byJob: readonly (PaceBoardRowDTO & { readonly jobId: string; readonly jobTypeId: string; readonly clientId: string; readonly jobTargetUph: DecimalString | null; readonly jobVersion: number; readonly unitLabel: string })[];
  readonly byClass: readonly PaceBoardRowDTO[];
  readonly byDay: readonly PaceBoardRowDTO[];
}

export interface PaceSuggestionRowDTO extends PaceSuggestionDTO {
  readonly jobTypeId: string;
  readonly jobTypeName: string;
  readonly unitLabel: string;
  /** The all clients, all classes target in force today, if any. */
  readonly current: DecimalString | null;
}

/* ------------------------------------------------------------------ profit team: explain, drill down, pivot, reports */

/** How a number in an explanation is written. Money is cents, percent is basis points. */
export type ExplainUnit = 'money' | 'percent' | 'number' | 'hours' | 'pace' | 'money_per_hour' | 'money_per_unit' | 'text';

export interface ExplainLineDTO {
  readonly label: string;
  /** Null when the reader may not see it. */
  readonly value: number | null;
  readonly unit: ExplainUnit;
  /** How the line joins the one above: the first line starts, `total` is the answer, `note` is extra detail. */
  readonly op: 'start' | 'plus' | 'minus' | 'times' | 'divide' | 'total' | 'note';
  /** For `text` lines and unit words ("kits"). */
  readonly text?: string | null;
}

/** `GET /api/v1/explain`: "How we got this" for one number (SPEC 4.15). */
export interface ExplainDTO {
  readonly metric: string;
  readonly title: string;
  /** What the number covers: "Acme Outdoor, Nov 1 to Nov 17, 2026". */
  readonly scope: string;
  /** The rule in plain words. */
  readonly formula: string;
  readonly lines: readonly ExplainLineDTO[];
  /** Data quality lines. Empty means the number is complete. */
  readonly quality: readonly string[];
  /** Links to the rows behind the number. */
  readonly links: readonly { readonly label: string; readonly href: string }[];
  readonly from: string;
  readonly to: string;
  readonly moneyHidden: boolean;
}

/** One stamped row behind a profit number, with the names a person needs to read it. */
export interface ProfitEntryDTO {
  readonly workDate: string;
  readonly kind: FactRowDTO['kind'];
  readonly amountCents: MoneyCents;
  readonly unitsGood: DecimalString;
  readonly hours: DecimalString;
  readonly jobId: string | null;
  readonly jobNumber: string | null;
  readonly jobName: string | null;
  readonly clientId: string;
  readonly clientName: string | null;
  readonly serviceName: string | null;
  readonly sourceTable: string;
  readonly sourceId: string;
  /** Where the row was typed: "Work log", "Extra service", "Cost". */
  readonly sourceLabel: string;
  readonly note: string | null;
}

export interface ProfitEntriesDTO {
  readonly rows: readonly ProfitEntryDTO[];
  /** True when more rows exist than were sent. */
  readonly truncated: boolean;
  readonly moneyHidden: boolean;
}

/** One cell of the pivot: the numbers where a row group meets a column group. */
export interface PivotCellDTO {
  readonly revenueCents: MoneyCents;
  readonly costCents: MoneyCents;
  readonly profitCents: MoneyCents;
  readonly marginBp: number | null;
  readonly unitsGood: DecimalString;
  readonly hours: DecimalString;
  /** An extra service cell with revenue and no cost of any kind: `marginBp` is null and the screen says "No cost yet". */
  readonly costMissing: boolean;
}

/** `GET /api/v1/profit/pivot`: profit grouped by two things at once. */
export interface ProfitPivotDTO {
  readonly rowBy: ProfitGroup;
  readonly colBy: ProfitGroup;
  readonly from: string;
  readonly to: string;
  readonly rows: readonly { readonly key: string; readonly label: string; readonly sublabel: string | null }[];
  readonly cols: readonly { readonly key: string; readonly label: string; readonly sublabel: string | null }[];
  /** `cells[rowKey][colKey]`; a missing cell had no activity. */
  readonly cells: Readonly<Record<string, Readonly<Record<string, PivotCellDTO>>>>;
  readonly rowTotals: Readonly<Record<string, PivotCellDTO>>;
  readonly colTotals: Readonly<Record<string, PivotCellDTO>>;
  readonly total: PivotCellDTO;
  readonly moneyHidden: boolean;
}

/** How a report cell is written. Money is cents, percent and points are basis points. */
export type ReportCellKind = 'text' | 'money' | 'percent' | 'number' | 'hours' | 'pace' | 'date' | 'datetime' | 'status' | 'job_status';
export type ReportCell = string | number | null;

export interface ReportColumnDTO {
  readonly key: string;
  readonly label: string;
  readonly kind: ReportCellKind;
  /** Holds money or a margin: blanked when the reader, or a scheduled build, may not see money. */
  readonly money?: boolean;
  /** Good direction, for the tone of a difference column. */
  readonly signed?: 'up_good' | 'down_good';
}

export interface ReportRowDTO {
  readonly id: string;
  readonly cells: Readonly<Record<string, ReportCell>>;
  /** Where the row leads (a job, a client), inside Pulse. */
  readonly href?: string | null;
}

export interface ReportSeriesDTO {
  readonly id: string;
  readonly label: string;
  readonly values: readonly (number | null)[];
}

export interface ReportChartDTO {
  readonly type: 'bar' | 'hbar' | 'stacked' | 'line' | 'combo' | 'waterfall' | 'pareto';
  readonly title: string;
  /** One sentence on how to read it. */
  readonly description: string;
  readonly labels: readonly string[];
  readonly series: readonly ReportSeriesDTO[];
  readonly format: 'money' | 'percent' | 'number' | 'hours';
  /** Combo charts: the line panel. */
  readonly lines?: readonly ReportSeriesDTO[];
  readonly lineFormat?: 'money' | 'percent' | 'number' | 'hours';
  /** Losses drawn in the down color. */
  readonly signColors?: boolean;
  /** Waterfall: where it starts and what the last bar is called. */
  readonly start?: { readonly label: string; readonly value: number };
  readonly endLabel?: string;
}

/** `GET /api/v1/reports/<slug>`: one built report. The page, the CSV and the print view all read this. */
/** Money in a report's total that belongs to no row of the ranking: costs and fees put on a client with no job. */
export interface ReportAsideDTO {
  readonly key: 'client_level';
  readonly label: string;
  /** Profit of these rows in cents: under zero when they cost more than they earned. Null when hidden. */
  readonly valueCents: number | null;
  /** One plain sentence on what the number is. */
  readonly text: string;
  /** How many entries are behind it. */
  readonly entryCount: number;
}

export interface ReportDTO {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly from: string;
  readonly to: string;
  /** False for reports about right now (open jobs at risk, ready to bill). */
  readonly usesDates: boolean;
  /** The filters in words: "Nov 1 to Nov 17, 2026, Main site". */
  readonly filtersLabel: string;
  readonly generatedAt: string;
  readonly columns: readonly ReportColumnDTO[];
  readonly rows: readonly ReportRowDTO[];
  readonly total: Readonly<Record<string, ReportCell>> | null;
  readonly summary: readonly { readonly label: string; readonly value: ReportCell; readonly kind: ReportCellKind }[];
  readonly chart: ReportChartDTO | null;
  /** A number that is in the total but is not one of the ranked rows, said in words under the chart. */
  readonly aside: ReportAsideDTO | null;
  /** Plain sentences on how to read the report or what is missing. */
  readonly notes: readonly string[];
  readonly truncated: boolean;
  readonly moneyHidden: boolean;
}

export interface ReportScheduleDTO {
  readonly id: string;
  readonly name: string;
  readonly report: string;
  readonly reportName: string;
  readonly cadence: 'daily' | 'weekly' | 'monthly';
  readonly weekday: number | null;
  readonly dayOfMonth: number | null;
  readonly hour: number;
  /** Which days each build covers and its filters: `{ range, siteId?, clientId?, jobTypeId? }`. */
  readonly config: Readonly<Record<string, unknown>>;
  readonly recipientUserIds: readonly string[];
  readonly includeMoney: boolean;
  readonly enabled: boolean;
  readonly lastRunAt: string | null;
  readonly nextRunAt: string | null;
  readonly createdBy: string | null;
  readonly mine: boolean;
  readonly canEdit: boolean;
}

export interface ReportRunDTO {
  readonly id: string;
  readonly scheduleId: string | null;
  readonly scheduleName: string | null;
  readonly report: string;
  readonly reportName: string;
  readonly periodLabel: string | null;
  readonly rowCount: number;
  readonly includeMoney: boolean;
  readonly status: 'ready' | 'failed';
  readonly error: string | null;
  readonly createdAt: string;
  /** False when the build holds money and the reader may not see money. */
  readonly canOpen: boolean;
}
