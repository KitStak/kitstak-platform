/**
 * Declarative model for seeded programs (docs/programs/SPEC.md 7). A data file lists programs as
 * plain objects plus a `day` hook; `program-builder.ts` walks the calendar one day at a time on
 * the program clock, so every row is written by the program domain the way the app writes it
 * (schedule sweeps, output, closes, price cards), then gets stable ids and believable times.
 */
import type { IsoDate } from '@/lib/program-types';
import type { Handle } from './types';

export interface SeedAxis {
  readonly name: string;
  /** `color` is a LABEL_COLORS name for the value chip (Brown is brown). */
  readonly values: readonly { readonly label: string; readonly code: string; readonly color?: string }[];
}

export interface SeedVariant {
  readonly key: string;
  readonly name: string;
  readonly sku: string | null;
  /** Axis name to value code, for matrix programs. */
  readonly attrs?: Readonly<Record<string, string>>;
  readonly defaultQty: string;
  /** A hand typed rate (a variant line on the first card). */
  readonly unitPrice?: string;
  readonly stdMinutes?: string;
  /** Core item SKU to link as the kit (KitStak org only). */
  readonly coreItemSku?: string;
  /** The variant dot (a LABEL_COLORS name). */
  readonly color?: string;
}

export type SeedCardLine =
  | { readonly kind: 'per_unit'; readonly variantKey?: string; readonly unitPrice: string }
  | { readonly kind: 'per_order'; readonly amountCents: string; readonly label?: string }
  | { readonly kind: 'per_hour'; readonly rateCents: number; readonly label?: string }
  | { readonly kind: 'flat_monthly' | 'monthly_minimum'; readonly amountCents: string; readonly prorate: boolean };

export interface SeedRule {
  readonly axis: string;
  readonly value: string;
  readonly op: 'add' | 'set';
  readonly amount: string;
}

export interface SeedScheduleLine {
  readonly variantKey: string;
  readonly qty: string;
  readonly qtyByWeekday?: Readonly<Record<string, string>>;
}

export interface SeedPrepTask {
  readonly title: string;
  readonly who: Handle;
  /** Day offset from today. */
  readonly due: number;
  readonly done?: boolean;
  readonly comments?: readonly (readonly [Handle, string])[];
  readonly watchers?: readonly Handle[];
  /** Billable minutes on these weekdays (0 Sunday to 6 Saturday), every week of the program. */
  readonly billableTime?: { readonly who: Handle; readonly weekdays: readonly number[]; readonly minutes: readonly number[] };
}

/** What the builder hands a day hook. */
export interface DayApi {
  readonly date: IsoDate;
  readonly today: IsoDate;
  readonly isToday: boolean;
  /** Day offset of `date` from today (0 today, negative in the past). */
  readonly offset: number;
  /** Weekday of `date`, 0 Sunday to 6 Saturday. */
  readonly weekday: number;
  /** Builds of this program dated `date` (or `on`), oldest first. */
  builds(on?: IsoDate): Promise<readonly SeedBuildRow[]>;
  /** Logs output for `date` (or `on`). Rows with `done` are marked done. */
  log(rows: readonly SeedLogRow[], options?: { readonly on?: IsoDate; readonly closeShort?: readonly { readonly buildId: string; readonly reason: string }[] }): Promise<void>;
  comment(taskId: string, who: Handle, text: string): Promise<void>;
  rateOverride(buildId: string, unitPrice: string, reason: string): Promise<void>;
  newBuilds(rows: readonly { readonly variantKey: string; readonly date: IsoDate; readonly qty: string }[]): Promise<void>;
  time(taskId: string, who: Handle, minutes: number, billable: boolean): Promise<void>;
  /**
   * Stretches a build over several work days, the way a person drags it on the timeline: the task
   * starts on `from` and is due on `to`, which becomes the build date (generic task update, 4.1).
   */
  span(buildId: string, from: IsoDate, to: IsoDate): Promise<void>;
  /** A deterministic 0..1 for this program and `salt`. */
  random(salt: string): number;
  /** The day is a work day on this program's calendar. */
  isWorkDay(date: IsoDate): boolean;
}

export interface SeedBuildRow {
  readonly id: string;
  readonly variantKey: string | null;
  readonly plannedQty: string;
  readonly builtQty: string;
  readonly buildDate: IsoDate;
  readonly done: boolean;
}

export interface SeedLogRow {
  readonly buildId?: string;
  /** An unplanned row on the day (Add a row). */
  readonly newVariantKey?: string;
  readonly qty: string;
  readonly done?: boolean;
  readonly note?: string;
}

export interface ProgramSeed {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  /** CRM account and won deal names (Northwind), or a core customer code (KitStak). */
  readonly account?: string;
  readonly deal?: string;
  readonly coreCustomer?: string;
  readonly unit: { readonly singular: string; readonly plural: string };
  /** null means the workspace calendar. */
  readonly workingDays: readonly number[] | null;
  readonly startOffset: number;
  readonly color: string;
  readonly icon: string;
  readonly targetCents?: string;
  readonly axes?: readonly SeedAxis[];
  readonly patterns?: { readonly name: string; readonly key: string; readonly sku: string | null };
  readonly variants: readonly SeedVariant[];
  readonly card: { readonly lines: readonly SeedCardLine[]; readonly rules: readonly SeedRule[] };
  readonly oneTime?: readonly { readonly label: string; readonly amountCents: string }[];
  readonly schedule: {
    readonly name: string;
    readonly pattern: 'daily' | 'weekdays' | 'custom_days' | 'every_n_weeks';
    readonly days: readonly number[];
    readonly leadDays: number;
    readonly lines: readonly SeedScheduleLine[];
    /** Dates the schedule skips (planned by hand instead), from today's date. */
    readonly skipDates?: (today: IsoDate) => readonly IsoDate[];
  };
  readonly owner: Handle;
  readonly members: readonly { readonly who: Handle; readonly role: 'editor' | 'commenter' | 'viewer' }[];
  readonly prepTasks: readonly SeedPrepTask[];
  /** Runs once per calendar day from the start to today, after the schedule sweep. */
  readonly day: (api: DayApi) => Promise<void>;
}

/** Org level story: price card changes, month closes, a draft and a template. */
export interface OrgProgramsSeed {
  readonly slug: string;
  readonly me: Handle;
  readonly people: Readonly<Record<Handle, string>>;
  readonly calendar: { readonly timezone: string; readonly workingDays: readonly number[]; readonly dailyCapacityHours: string };
  readonly programs: readonly ProgramSeed[];
  /** Runs once per calendar day for the whole org, after every program's day hook. */
  readonly orgDay?: (api: OrgDayApi) => Promise<void>;
  /** Runs once at the end, on today. */
  readonly finish?: (api: OrgDayApi) => Promise<void>;
}

export interface OrgDayApi {
  readonly date: IsoDate;
  readonly today: IsoDate;
  readonly offset: number;
  /** First day of the month `months` away from today's month (0 this month). */
  monthStart(months: number): IsoDate;
  /** The n-th work day (1 based) of the month that starts on `monthStart`, workspace calendar. */
  nthWorkDay(monthStart: IsoDate, n: number): IsoDate;
  publishVersion(key: string, input: { readonly effectiveFrom: IsoDate; readonly lines: readonly SeedCardLine[]; readonly rules: readonly SeedRule[]; readonly by: Handle }): Promise<void>;
  draftVersion(key: string, input: { readonly effectiveFrom: IsoDate; readonly lines: readonly SeedCardLine[]; readonly rules: readonly SeedRule[]; readonly by: Handle; readonly askReview: boolean; readonly note?: string }): Promise<void>;
  closeMonth(key: string, month: string, by: Handle): Promise<void>;
  adjustment(key: string, input: { readonly label: string; readonly amountCents: string; readonly reason: string; readonly countsTowardMinimum: boolean; readonly by: Handle }): Promise<void>;
  projectBuild(projectKey: string, input: { readonly title: string; readonly qty: string; readonly offset: number; readonly by: Handle }): Promise<void>;
  wizardDraft(input: { readonly title: string; readonly step: number; readonly deal: string | null; readonly by: Handle }): Promise<void>;
  template(key: string, input: { readonly name: string; readonly description: string; readonly by: Handle }): Promise<void>;
  linkKit(key: string, variantKey: string, wmsSku: string): Promise<void>;
}
