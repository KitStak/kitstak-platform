/**
 * Wire shapes of the program tracker (docs/programs/PULSE_PROGRAMS_SPEC.md sections 4 and 7). The
 * server reads in `src/server/domain/programs.ts` return these, the routes under
 * `/api/v1/programs/**` send them as `{ data }`, and the screens read them.
 *
 * Conventions (the same as `types.ts`):
 * - Money is `MoneyCents`: whole cents as a JS number, or null. It is null when the reader may
 *   not see money (`moneyHidden: true`): revenue, cost, profit, margins, forecasts in cents and
 *   targets are then all null. Units, hours, units per hour and planned units are always there.
 * - Margins and shares are basis points (`3000` is 30%), null when hidden or not defined.
 * - Quantities are `DecimalString` with 3 places (`"560.000"`), hours with 2 places.
 * - Dates are `YYYY-MM-DD`, months `YYYY-MM`, both in the program's time zone.
 * - `projectsPath` is a path inside the Projects app (`/programs/GLOVE`); add the Projects origin.
 *   `path` is a path inside Pulse.
 */
import type { ProgramAlertAction, ProgramRule } from './profit/program-risk';
import type { DecimalString, MoneyCents } from './types';

/** Program statuses as stored in Projects (shared with projects). */
export type ProgramStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'archived';

/** The status chip words (docs/programs/SPEC.md 2.2.17 `PROGRAM_STATUS_LABELS`). */
export const PROGRAM_STATUS_LABELS: Readonly<Record<ProgramStatus, string>> = {
  planning: 'Setting up',
  active: 'Running',
  on_hold: 'Paused',
  completed: 'Ended',
  archived: 'Archived',
};

/**
 * The health dot of a program this month, from its alerts (section 6):
 * - `losing`: the forecast margin is below zero (with at least 3 work days with units).
 * - `at_risk`: P1, P2, P4 or P5 fired.
 * - `heads_up`: only P3, P6 or P7 fired.
 * - `no_data`: no units yet this month and nothing planned.
 * - `on_track`: none of the above.
 * A reader who cannot see money only gets P6 and P7, so their dot is at most `heads_up`.
 */
export type ProgramHealth = 'on_track' | 'heads_up' | 'at_risk' | 'losing' | 'no_data';

/** Why the program tracker is not shown. */
export type ProgramsUnavailableReason = 'not_entitled' | 'not_ready';

export interface ProgramsAvailabilityDTO {
  /** Programs can be shown: Projects is on, and the program tables and `core.record_links` exist. Hide the nav item and pages when false. */
  readonly available: boolean;
  /** `not_entitled`: Projects is not part of this plan or not connected. `not_ready`: Projects is on but its program tables are missing. */
  readonly reason: ProgramsUnavailableReason | null;
}

export interface ProgramUnitDTO {
  /** `kit`. */
  readonly singular: string;
  /** `kits`. */
  readonly plural: string;
}

/** Money and units of one program month (spec 3.1). */
export interface ProgramFiguresDTO {
  /** Good units (scrap is not in here). */
  readonly units: DecimalString;
  readonly scrap: DecimalString;
  /** Build hours plus every hour on the program job (typed, kiosk, prep work in Projects). */
  readonly hours: DecimalString;
  /** Good units per labor hour, 3 places. Null with no hours. */
  readonly unitsPerHour: DecimalString | null;
  /** Work revenue plus fees. */
  readonly revenueCents: MoneyCents;
  /** Revenue of the build lines (units times their card price). */
  readonly workRevenueCents: MoneyCents;
  /** Program fees, adjustments and minimum top ups from the ledger. */
  readonly feeCents: MoneyCents;
  readonly laborCents: MoneyCents;
  readonly materialCents: MoneyCents;
  readonly otherCents: MoneyCents;
  readonly sharedCents: MoneyCents;
  readonly costCents: MoneyCents;
  readonly profitCents: MoneyCents;
  readonly marginBp: number | null;
  readonly revenuePerUnitCents: MoneyCents;
  readonly costPerUnitCents: MoneyCents;
  readonly profitPerUnitCents: MoneyCents;
  /** Days of the month with good units. */
  readonly daysWithUnits: number;
}

/** The month's plan, read from Projects (spec 3.3). Units are always there; money is null when hidden. */
export interface ProgramPlanDTO {
  /** The day the forecast is read as of (today, or the first day of a month still ahead). */
  readonly asOf: string;
  /** Output so far in the month, as Projects counts it. */
  readonly builtUnits: DecimalString;
  /** Built so far plus what open builds dated today to month end still have to make. */
  readonly plannedUnits: DecimalString;
  /** The month forecast, equal to Projects to the cent. */
  readonly forecastCents: MoneyCents;
  /** `planned`: from planned builds. `recent`: from recent days. */
  readonly forecastMethod: 'planned' | 'recent';
  /** `pm.program_settings.monthly_target_cents`. */
  readonly targetCents: MoneyCents;
  /** The monthly minimum in force, or null when the card has none (or money is hidden). */
  readonly minimumCents: MoneyCents;
  /** How far the forecast falls short of the minimum. 0 when it does not. */
  readonly projectedGapCents: MoneyCents;
  /** Revenue of the month so far as the engine counts it. */
  readonly actualCents: MoneyCents;
}

/** Cost to the end of the month (spec 3.4). */
export interface ProgramCostForecastDTO {
  /** `month`: this month's cost per unit. `recent_days`: the last 20 work days (fewer than 3 work days with units this month). */
  readonly basis: 'month' | 'recent_days';
  readonly daysUsed: number;
  readonly unitsSoFar: DecimalString;
  /** Planned units still to make, never below 0. */
  readonly remainingUnits: DecimalString;
  readonly costSoFarCents: MoneyCents;
  readonly costPerUnitCents: MoneyCents;
  readonly forecastRevenueCents: MoneyCents;
  readonly forecastCostCents: MoneyCents;
  readonly forecastProfitCents: MoneyCents;
  readonly forecastMarginBp: number | null;
  /**
   * False when there is no cost yet: the screen says "Not enough days yet." in place of the
   * forecast margin. Always false when money is hidden.
   */
  readonly enoughDays: boolean;
}

/** The customer's target margin (spec 3.5): "Target 30% for this customer" with "Change it on the client". */
export interface ProgramTargetDTO {
  /** Null when money is hidden. */
  readonly targetMarginBp: number | null;
  /** `client`: set on the Pulse client. `org`: the workspace default. */
  readonly source: 'client' | 'org';
  /** The Pulse client the program job belongs to, for "Change it on the client". */
  readonly clientId: string | null;
  /** Pulse path of that client page. */
  readonly clientPath: string | null;
}

/**
 * Pulse against Projects for the month (docs/programs/SPEC.md 6.1): Projects is the stored output
 * plus the ledger (`readProgramMonth`), Pulse is the program's revenue here.
 * - `matches`: "Matches Projects to the cent".
 * - `catching_up`: different and a program sync is waiting: "Pulse is catching up".
 * - `off`: different and nothing waiting: "Pulse is $12.40 off" with "Sync now".
 * - `unknown`: Projects could not be read, or the program was deleted there.
 */
export interface ProgramParityDTO {
  readonly status: 'matches' | 'catching_up' | 'off' | 'unknown';
  /**
   * Show the line to this reader (the SPEC 6.1 audience): owners and admins see every status;
   * others who see money see `catching_up` once the sync has waited 10 minutes; nobody else.
   */
  readonly visible: boolean;
  /** Projects minus Pulse. Null when hidden or unknown. */
  readonly diffCents: MoneyCents;
  readonly projectsCents: MoneyCents;
  readonly pulseCents: MoneyCents;
  /** When the oldest waiting program change came in (ISO time), or null. */
  readonly pendingSince: string | null;
  readonly lastSyncAt: string | null;
  /** The reader may press "Sync now" (owners and admins). */
  readonly canSync: boolean;
}

/** One program alert (spec 6) with its one action. */
export interface ProgramAlertDTO {
  readonly rule: ProgramRule;
  readonly sentence: string;
  readonly action: ProgramAlertAction;
  readonly actionLabel: string;
  /** The variant the action opens (P4), else null. */
  readonly variantId: string | null;
}

/** The top of every program page. */
export interface ProgramHeaderDTO {
  readonly programId: string;
  readonly key: string;
  readonly name: string;
  readonly status: ProgramStatus;
  /** "Running", "Paused", "Ended" (SPEC labels). */
  readonly statusLabel: string;
  /** Deleted in Projects: "This program was deleted in Projects. Its past months stay here." The page is read only. */
  readonly deleted: boolean;
  /** Nothing can be changed from this page (deleted program, or the reader cannot manage jobs). */
  readonly readOnly: boolean;
  readonly customerName: string | null;
  readonly unit: ProgramUnitDTO;
  readonly timezone: string;
  /** The Pulse client of the program job. */
  readonly client: { readonly id: string; readonly name: string } | null;
  /** The program job ("Open the job" goes to `jobPath`). Null when Pulse has no job for it. */
  readonly job: { readonly id: string; readonly number: string; readonly name: string; readonly path: string } | null;
  /** The price card version in force today (`2` for v2), or null. */
  readonly cardVersion: number | null;
  /** "Open in Projects". */
  readonly projectsPath: string;
  /** Pulse path of this program page. */
  readonly path: string;
}

export interface ProgramMonthMetaDTO {
  readonly month: string;
  /** Today in the program zone, clamped into the month. */
  readonly asOf: string;
  /** The month is closed in Pulse. */
  readonly closed: boolean;
  /** `past`, `current` or `future`, from today in the program zone. */
  readonly when: 'past' | 'current' | 'future';
}

/** One day of the Overview chart: running totals from the first of the month. */
export interface ProgramChartDayDTO {
  readonly date: string;
  readonly revenueCents: MoneyCents;
  readonly costCents: MoneyCents;
  readonly units: DecimalString;
}

/** `GET /api/v1/programs/[key]?month=`: the Overview tab (spec 4, 7.3). */
export interface ProgramMonthDTO {
  readonly header: ProgramHeaderDTO;
  readonly month: ProgramMonthMetaDTO;
  readonly figures: ProgramFiguresDTO;
  /** Null when Projects could not be read or the program was deleted there. */
  readonly plan: ProgramPlanDTO | null;
  /** Null when there is no plan. */
  readonly costForecast: ProgramCostForecastDTO | null;
  readonly target: ProgramTargetDTO;
  readonly parity: ProgramParityDTO;
  /** Every alert that fires, in rule order. Show up to 3 on the Overview. */
  readonly alerts: readonly ProgramAlertDTO[];
  readonly health: ProgramHealth;
  /** Running revenue and cost per day of the month up to `month.asOf` (every day, not only work days). */
  readonly chart: readonly ProgramChartDayDTO[];
  readonly moneyHidden: boolean;
}

/** One row of the By variant table. */
export interface ProgramVariantRowDTO {
  /** Null on the "Not tied to a variant" row. */
  readonly variantId: string | null;
  /** The variant name, "Removed variant" for a variant gone from Projects, "Not tied to a variant" for the footer row. */
  readonly name: string;
  readonly key: string | null;
  readonly sku: string | null;
  readonly color: string | null;
  /** The variant is retired in Projects (still shown while it has numbers). */
  readonly retired: boolean;
  /** Built plus open planned units this month (from Projects). Null on the footer row. */
  readonly plannedUnits: DecimalString | null;
  readonly units: DecimalString;
  readonly scrap: DecimalString;
  readonly hours: DecimalString;
  readonly revenueCents: MoneyCents;
  readonly laborCents: MoneyCents;
  readonly materialCents: MoneyCents;
  readonly otherCents: MoneyCents;
  readonly sharedCents: MoneyCents;
  readonly costCents: MoneyCents;
  readonly profitCents: MoneyCents;
  readonly marginBp: number | null;
  readonly profitPerUnitCents: MoneyCents;
  /** Share of all program revenue (work plus fees). */
  readonly revenueShareBp: number | null;
}

/** `GET /api/v1/programs/[key]/variants?month=`: the By variant tab. Rows plus fees plus not tied add up to `total`, which equals the Overview. */
export interface ProgramVariantsDTO {
  readonly header: ProgramHeaderDTO;
  readonly month: ProgramMonthMetaDTO;
  /** Variants with units or a plan this month, most revenue first, then planned only ones in card order. */
  readonly variants: readonly ProgramVariantRowDTO[];
  /** "Program fees": the fee rows of the month by kind (`fee`, `adjustment`). */
  readonly fees: { readonly totalCents: MoneyCents; readonly byKind: readonly { readonly kind: string; readonly cents: MoneyCents }[] };
  /** "Not tied to a variant": job cost on days with no units, and build lines with no variant. */
  readonly notTiedToVariant: ProgramVariantRowDTO;
  readonly total: ProgramFiguresDTO;
  readonly moneyHidden: boolean;
}

/** One month of the By month tab. */
export interface ProgramMonthRowDTO {
  readonly month: string;
  readonly units: DecimalString;
  readonly hours: DecimalString;
  readonly unitsPerHour: DecimalString | null;
  readonly revenueCents: MoneyCents;
  readonly costCents: MoneyCents;
  readonly profitCents: MoneyCents;
  readonly marginBp: number | null;
  /** The customer's target margin (the same every month). */
  readonly targetMarginBp: number | null;
  /**
   * The monthly minimum: `met`, `missed` (a minimum top up was charged), `open` (the month is not
   * settled in Projects yet), or `none` (no minimum on the card). Null when money is hidden.
   */
  readonly minimum: 'met' | 'missed' | 'open' | 'none' | null;
  readonly minimumCents: MoneyCents;
  /** Closed in Pulse. */
  readonly closed: boolean;
}

/** `GET /api/v1/programs/[key]/months?from=&to=`: the By month tab, newest month first. */
export interface ProgramMonthsDTO {
  readonly header: ProgramHeaderDTO;
  readonly from: string;
  readonly to: string;
  readonly months: readonly ProgramMonthRowDTO[];
  readonly moneyHidden: boolean;
}

/** One work day (or a day off with activity) of the Days tab. */
export interface ProgramDayRowDTO {
  readonly date: string;
  /** A plannable work day of the program calendar. Days off show only when they have activity. */
  readonly workDay: boolean;
  /** Planned qty of every build dated that day (from Projects). */
  readonly plannedUnits: DecimalString;
  readonly units: DecimalString;
  readonly scrap: DecimalString;
  readonly hours: DecimalString;
  readonly unitsPerHour: DecimalString | null;
  readonly revenueCents: MoneyCents;
  readonly costCents: MoneyCents;
  readonly profitCents: MoneyCents;
  /** Units and no hours that day: show "Add hours" with `addHoursPath`. */
  readonly missingHours: boolean;
  /** The daily log for that day, prefilled for the program job. Null when there is no job. */
  readonly addHoursPath: string | null;
}

/** `GET /api/v1/programs/[key]/days?month=`: every work day of the month, oldest first. */
export interface ProgramDaysDTO {
  readonly header: ProgramHeaderDTO;
  readonly month: ProgramMonthMetaDTO;
  readonly days: readonly ProgramDayRowDTO[];
  readonly moneyHidden: boolean;
}

/** One row of the Labor tab. */
export interface ProgramLaborRowDTO {
  /** The labor class id, or null for "No labor class" and the prep row. */
  readonly laborClassId: string | null;
  /** `class`: hours of one labor class. `prep`: "Prep work in Projects" (`pmt:` rows), always its own row. */
  readonly kind: 'class' | 'prep';
  readonly name: string;
  readonly hours: DecimalString;
  readonly laborCents: MoneyCents;
  /** Share of the program's labor hours. */
  readonly hoursShareBp: number | null;
}

/** One person of the Labor tab. */
export interface ProgramPersonRowDTO {
  /** `projects`: time logged on the program's builds and tasks in Projects. `punch`: time punches on the program job. */
  readonly source: 'projects' | 'punch';
  /** A Projects user id, or the employee code of a punch. */
  readonly personId: string;
  readonly name: string;
  readonly hours: DecimalString;
  /** Build hours (Projects time on builds). 0 for punches. */
  readonly buildHours: DecimalString;
  /** Prep hours (Projects time on other program tasks). 0 for punches. */
  readonly prepHours: DecimalString;
  /** Pay of punches, only for readers who see wages. Null for Projects time (Pulse costs it by labor class). */
  readonly payCents: MoneyCents;
}

/** `GET /api/v1/programs/[key]/labor?month=`: hours and cost by labor class and by person. */
export interface ProgramLaborDTO {
  readonly header: ProgramHeaderDTO;
  readonly month: ProgramMonthMetaDTO;
  /** Labor classes, most hours first, then "Prep work in Projects". Adds up to `totals`. */
  readonly byClass: readonly ProgramLaborRowDTO[];
  readonly byPerson: readonly ProgramPersonRowDTO[];
  /** Hours with no name on them (typed crew hours, the daily log). */
  readonly hoursWithoutName: DecimalString;
  readonly totals: { readonly hours: DecimalString; readonly laborCents: MoneyCents; readonly unitsPerHour: DecimalString | null };
  readonly moneyHidden: boolean;
}

/** One row of the Programs list (`/programs`). */
export interface ProgramListRowDTO {
  readonly programId: string;
  readonly key: string;
  readonly name: string;
  readonly customerName: string | null;
  readonly status: ProgramStatus;
  readonly statusLabel: string;
  readonly deleted: boolean;
  readonly unit: ProgramUnitDTO;
  readonly jobId: string | null;
  readonly jobNumber: string | null;
  readonly units: DecimalString;
  readonly plannedUnits: DecimalString | null;
  readonly hours: DecimalString;
  readonly unitsPerHour: DecimalString | null;
  readonly revenueCents: MoneyCents;
  readonly costCents: MoneyCents;
  readonly profitCents: MoneyCents;
  readonly marginBp: number | null;
  readonly targetMarginBp: number | null;
  readonly forecastRevenueCents: MoneyCents;
  readonly forecastMarginBp: number | null;
  readonly health: ProgramHealth;
  /** The first alert sentence, for the health dot tooltip. */
  readonly healthReason: string | null;
  /** The last day with any program row in Pulse, or null. */
  readonly lastActivityDate: string | null;
  /** Pulse path of the program page. */
  readonly path: string;
  readonly projectsPath: string;
}

/** A program in Projects with no Pulse job yet ("Not tracked yet"). */
export interface ProgramNotTrackedDTO {
  readonly programId: string;
  readonly key: string;
  readonly name: string;
  readonly customerName: string | null;
  readonly status: ProgramStatus;
  readonly statusLabel: string;
  readonly unit: ProgramUnitDTO;
  /** The Pulse client matched by core customer or CRM account. Null: "Track in Pulse" asks for a client. */
  readonly matchedClient: { readonly id: string; readonly name: string } | null;
  readonly projectsPath: string;
}

/** `GET /api/v1/programs?month=`: the Programs list. */
export interface ProgramListDTO {
  readonly available: boolean;
  readonly reason: ProgramsUnavailableReason | null;
  readonly month: string;
  readonly programs: readonly ProgramListRowDTO[];
  readonly notTracked: readonly ProgramNotTrackedDTO[];
  /** Footer: money summed, units summed per unit word. */
  readonly totals: {
    readonly revenueCents: MoneyCents;
    readonly costCents: MoneyCents;
    readonly profitCents: MoneyCents;
    readonly marginBp: number | null;
    readonly unitsByLabel: readonly { readonly unitPlural: string; readonly units: DecimalString }[];
  };
  /** The reader may press "Track in Pulse" (`job:manage`). */
  readonly canTrack: boolean;
  readonly moneyHidden: boolean;
}

/** What `trackProgram` and `convertToProgramJob` give back. */
export interface TrackedProgramDTO {
  readonly programId: string;
  readonly key: string;
  readonly jobId: string;
  readonly jobNumber: string;
  /** False when nothing changed (already a program job). */
  readonly changed: boolean;
  /** Pulse path of the program page. */
  readonly path: string;
}

/** `programForJob`: the program a job holds, for the job page redirect and banner. */
export interface JobProgramRefDTO {
  readonly programId: string;
  readonly key: string;
  readonly name: string;
  /** The price card version in force today, or null. */
  readonly cardVersion: number | null;
  readonly deleted: boolean;
  /** Pulse path of the program page. */
  readonly path: string;
  readonly projectsPath: string;
}
