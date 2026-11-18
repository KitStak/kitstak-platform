/**
 * Sample data behind the Pulse page illustrations.
 *
 * Every figure here comes from the Pulse demo workspace and the worked examples in docs/pulse/SPEC.md
 * (the real cost of an hour in 4.3, plan vs actual and "Why profit changed" in 4.10 and 4.11, the company
 * profit bridge in 4.9, standard material cost in 4.6 and the story jobs in section 9), so the coded
 * visuals agree with the product screenshots that replace them later. Totals are never typed twice: they
 * are added up from the rows, and pulse-visual-data.test.ts checks that every view agrees.
 */

/* ===== Formatting ===== */

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const USD_CENTS = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const COUNT = new Intl.NumberFormat('en-US');

/** Whole dollars, with a plain hyphen for a loss: "$48,210", "-$1,320". */
export function money(dollars: number): string {
  return USD.format(dollars);
}

/** Dollars and cents: "$21.76". */
export function moneyCents(dollars: number): string {
  return USD_CENTS.format(dollars);
}

/** A change in dollars with its sign always shown: "+$600", "-$550", "$0". */
export function signedMoney(dollars: number): string {
  return dollars > 0 ? `+${USD.format(dollars)}` : USD.format(dollars);
}

export function count(value: number): string {
  return COUNT.format(value);
}

/** Margin is profit as a share of money in, to one decimal place. */
export function marginOf(profit: number, moneyIn: number): number {
  return moneyIn === 0 ? 0 : Math.round((profit / moneyIn) * 1000) / 10;
}

export function percent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

/* ===== Job status ===== */

export type RiskStatus = 'losing-money' | 'at-risk' | 'heads-up' | 'not-enough-data' | 'on-track';

/** The five status words, the same in every KitStak app, with the label token each one uses. */
export const STATUS: Readonly<Record<RiskStatus, { readonly label: string; readonly token: string }>> = {
  'losing-money': { label: 'Losing money', token: 'red' },
  'at-risk': { label: 'At risk', token: 'orange' },
  'heads-up': { label: 'Heads up', token: 'yellow' },
  'not-enough-data': { label: 'Not enough data', token: 'gray' },
  'on-track': { label: 'On track', token: 'green' },
};

/* ===== Profit this month ===== */

export const PERIOD = 'November';

export interface ProfitRow {
  readonly name: string;
  /** A job number, shown in the mono face before the name. */
  readonly code?: string;
  readonly moneyIn: number;
  readonly profit: number;
  /** A rolled up row ("20 more jobs"), set apart from the named rows. */
  readonly isRest?: true;
}

export type ProfitViewId = 'job' | 'client' | 'type' | 'service';

export interface ProfitView {
  readonly id: ProfitViewId;
  readonly tab: string;
  /** Column heading for the name column. */
  readonly heading: string;
  readonly rows: readonly ProfitRow[];
}

/** The Profit page, cut four ways. Every view adds up to the same total, as it does in the product. */
export const PROFIT_VIEWS: readonly ProfitView[] = [
  {
    id: 'job',
    tab: 'Job',
    heading: 'Job',
    rows: [
      { code: 'J-1005', name: 'Lumen Skincare launch kit', moneyIn: 18600, profit: 7626 },
      { code: 'J-1027', name: 'Apex Threads retail display build', moneyIn: 21300, profit: 7455 },
      { code: 'J-1013', name: 'Voltbyte desk dock kit', moneyIn: 12400, profit: 4216 },
      { name: '20 more jobs', moneyIn: 90316, profit: 30689, isRest: true },
      { code: 'J-1019', name: 'Summit Trail starter kit relabel', moneyIn: 2400, profit: -144 },
      { code: 'J-1026', name: 'Orchard Pet Supply chew toy 3-pack', moneyIn: 3900, profit: -312 },
      { code: 'J-1012', name: 'Harbor Roast holiday gift set', moneyIn: 6600, profit: -1320 },
    ],
  },
  {
    id: 'client',
    tab: 'Client',
    heading: 'Client',
    rows: [
      { name: 'Lumen Skincare', moneyIn: 31200, profit: 13104 },
      { name: 'Apex Threads', moneyIn: 27450, profit: 10431 },
      { name: 'NovaForge Electronics', moneyIn: 24800, profit: 8928 },
      { name: 'Voltbyte Labs', moneyIn: 19600, profit: 6860 },
      { name: 'Bluebird & Main', moneyIn: 18900, profit: 4536 },
      { name: 'Copperline Coffee', moneyIn: 11400, profit: 2958 },
      { name: 'Summit Trail Gear', moneyIn: 7300, profit: 1473 },
      { name: 'Orchard Pet Supply', moneyIn: 8266, profit: 1240 },
      { name: 'Harbor Roast Collective', moneyIn: 6600, profit: -1320 },
    ],
  },
  {
    id: 'type',
    tab: 'Job type',
    heading: 'Job type',
    rows: [
      { name: 'Kit assembly', moneyIn: 52300, profit: 19351 },
      { name: 'Subscription box', moneyIn: 38400, profit: 11136 },
      { name: 'Retail display build', moneyIn: 27450, profit: 10431 },
      { name: 'Returns refurbish', moneyIn: 9800, profit: 3234 },
      { name: 'Gift set', moneyIn: 14866, profit: 3122 },
      { name: 'Rework and relabel', moneyIn: 12700, profit: 936 },
    ],
  },
  {
    id: 'service',
    tab: 'Service',
    heading: 'Extra service',
    rows: [
      { name: 'Core job work', moneyIn: 121400, profit: 36420 },
      { name: 'Labeling', moneyIn: 9800, profit: 4116 },
      { name: 'Shrink wrap', moneyIn: 8150, profit: 2934 },
      { name: 'Insert cards', moneyIn: 6400, profit: 2560 },
      { name: 'Quality check', moneyIn: 5266, profit: 1580 },
      { name: 'Poly bagging', moneyIn: 4500, profit: 600 },
    ],
  },
];

export interface ProfitTotal {
  readonly moneyIn: number;
  readonly moneyOut: number;
  readonly profit: number;
  readonly margin: number;
}

export function totalOf(rows: readonly ProfitRow[]): ProfitTotal {
  const moneyIn = rows.reduce((sum, row) => sum + row.moneyIn, 0);
  const profit = rows.reduce((sum, row) => sum + row.profit, 0);
  return { moneyIn, moneyOut: moneyIn - profit, profit, margin: marginOf(profit, moneyIn) };
}

/** The month on jobs: money in $155,516, money out $107,306, profit $48,210, a 31% margin. */
export const MONTH: ProfitTotal = totalOf(PROFIT_VIEWS[0]!.rows);

/**
 * The page's signature picture: of every dollar that came in, how many cents went out and how many
 * stayed as profit. Whole percents that always add up to 100.
 */
export function splitOf(
  moneyIn: number,
  moneyOut: number,
): { readonly out: number; readonly profit: number } {
  const out = Math.round((moneyOut / moneyIn) * 100);
  return { out, profit: 100 - out };
}

/**
 * The three steps between job profit and company profit, in plain words. In the product they read
 * "Time not on a job that no job carried", "Paid time not on any job" and "Overhead your hourly rate
 * did not cover" (SPEC 4.9). The first two sound alike out of context, so the page says what each is.
 */
export const BRIDGE_LABELS = [
  'Meetings, cleanup and waiting that no job carried',
  'Paid hours nobody logged',
  'Overhead your hourly rate did not cover',
] as const;

/** The walk from profit on jobs to what the company made (SPEC 4.9). */
export const BRIDGE_STEPS: readonly { readonly label: string; readonly amount: number }[] = [
  { label: BRIDGE_LABELS[0], amount: -1150 },
  { label: BRIDGE_LABELS[1], amount: -2360 },
  { label: BRIDGE_LABELS[2], amount: -4800 },
];
export const COMPANY_PROFIT = BRIDGE_STEPS.reduce((sum, step) => sum + step.amount, MONTH.profit);

/* ===== Open jobs ===== */

export interface OpenJob {
  readonly code: string;
  readonly name: string;
  readonly status: RiskStatus;
  /** The reason in a sentence, in the product's own wording. */
  readonly reason: string;
  readonly nextStep?: string;
  /** Margin so far and projected margin, in percent. Left out while the job's profit is not complete. */
  readonly margin?: { readonly soFar: number; readonly projected: number };
  /** The dollar impact, when money is at stake (SPEC 4.14). */
  readonly impact?: string;
}

/*
 * The margins and impacts below follow the spec's rules (SPEC 4.14).
 * J-1012: the month in the Profit table is the job so far, $6,600 in and a $1,320 loss, so -20.0%. At
 *   this pace it ends $1,840 in the red on $9,200, the same -20.0%.
 * J-1023: heading for 14% on $16,000 at finish. A 30% target would be $4,800 and the job is heading
 *   for $2,240, so the impact is $2,560.
 * J-1005: $18,600 in and $7,626 of profit so far, 41.0%.
 */

/** One open job for each status, worst first, the way the Jobs list sorts them. */
export const OPEN_JOBS: readonly OpenJob[] = [
  {
    code: 'J-1012',
    name: 'Harbor Roast holiday gift set',
    status: 'losing-money',
    reason: 'The crew is making 31 units per person per hour. The target pace is 46.',
    nextStep: 'Check the crew size',
    margin: { soFar: -20, projected: -20 },
    impact: '$1,840 loss at finish',
  },
  {
    code: 'J-1023',
    name: 'Bluebird & Main November subscription box',
    status: 'at-risk',
    reason: 'Margin is heading for 14%. Your target is 30%.',
    nextStep: 'Review the price with the client',
    margin: { soFar: 16.5, projected: 14 },
    impact: '$2,560 under your target profit',
  },
  {
    code: 'J-1031',
    name: 'NovaForge accessory bundle',
    status: 'heads-up',
    reason: 'Nothing has been logged for 4 work days.',
    nextStep: 'Log the missing days',
    margin: { soFar: 31.5, projected: 31 },
  },
  {
    code: 'J-1036',
    name: 'Voltbyte cable kit',
    status: 'not-enough-data',
    reason: '3 days have units and no hours. Profit is not complete yet.',
    nextStep: 'Add the hours',
  },
  {
    code: 'J-1005',
    name: 'Lumen Skincare launch kit',
    status: 'on-track',
    reason: 'On track. Margin is heading for 41% against a 30% target.',
    margin: { soFar: 41, projected: 41 },
  },
];

/** The status filter chips above the Jobs list: every open job in the demo workspace. */
export const STATUS_COUNTS: readonly { readonly status: RiskStatus; readonly jobs: number }[] = [
  { status: 'losing-money', jobs: 3 },
  { status: 'at-risk', jobs: 3 },
  { status: 'heads-up', jobs: 4 },
  { status: 'not-enough-data', jobs: 2 },
  { status: 'on-track', jobs: 10 },
];

/** Jobs that need you are the losing and at risk ones (SPEC 8.1, listJobsNeedingAttention): 6 here. */
export const NEEDS_YOU_COUNT = STATUS_COUNTS.filter(
  (item) => item.status === 'losing-money' || item.status === 'at-risk',
).reduce((sum, item) => sum + item.jobs, 0);

/** "Jobs that need you" on Home: the three worst of them. */
export const NEEDS_YOU: readonly OpenJob[] = [
  {
    code: 'J-1012',
    name: 'Harbor Roast holiday gift set',
    status: 'losing-money',
    reason: 'At this pace the job ends about $1,840 in the red.',
  },
  {
    code: 'J-1019',
    name: 'Summit Trail starter kit relabel',
    status: 'losing-money',
    reason: 'Labor is heading 60% over the plan.',
  },
  {
    code: 'J-1023',
    name: 'Bluebird & Main November subscription box',
    status: 'at-risk',
    reason: 'Margin is heading for 14%. Your target is 30%.',
  },
];

/* ===== Log work ===== */

export interface LogRow {
  readonly code: string;
  readonly name: string;
  readonly units: number;
  readonly people: number;
  readonly hoursEach: number;
  readonly targetPace: number;
  /** Crew lines, one per labor class. They add up to `people`. */
  readonly crew?: readonly { readonly laborClass: string; readonly people: number }[];
  readonly note?: string;
}

export const LOG_DAY = 'Tuesday, Nov 17';

/*
 * J-1012 sells at $2.75 a unit (SPEC 9), so its $6,600 of money in this month is 2,400 units. The
 * day below and the day in the CSV preview are 744 and 720 of them, so the days fit inside the month.
 */

export const LOG_ROWS: readonly LogRow[] = [
  {
    code: 'J-1005',
    name: 'Lumen Skincare launch kit',
    units: 4320,
    people: 12,
    hoursEach: 8,
    targetPace: 40,
    crew: [
      { laborClass: 'Packers', people: 8 },
      { laborClass: 'Temp packers', people: 3 },
      { laborClass: 'Line lead', people: 1 },
    ],
  },
  {
    code: 'J-1012',
    name: 'Harbor Roast holiday gift set',
    units: 744,
    people: 3,
    hoursEach: 8,
    targetPace: 46,
  },
  {
    code: 'J-1023',
    name: 'Bluebird & Main November subscription box',
    units: 1520,
    people: 5,
    hoursEach: 8,
    targetPace: 40,
  },
  {
    code: 'J-1040',
    name: 'Bluebird & Main gift card sleeves',
    units: 600,
    people: 3,
    hoursEach: 8,
    targetPace: 40,
    note: 'First day',
  },
];

export function laborHours(row: LogRow): number {
  return row.people * row.hoursEach;
}

/** Units per person per hour, rounded to a whole unit the way the grid reads it out. */
export function paceOf(units: number, hours: number): number {
  return hours === 0 ? 0 : Math.round(units / hours);
}

export const LOG_TOTAL = {
  units: LOG_ROWS.reduce((sum, row) => sum + row.units, 0),
  hours: LOG_ROWS.reduce((sum, row) => sum + laborHours(row), 0),
};

/* ===== Plan vs actual ===== */

export interface PlanLine {
  readonly label: string;
  readonly plan: number;
  readonly actual: number;
  readonly kind: 'in' | 'cost';
}

/** A job at 4,000 of 10,000 units. The plan is scaled to the work done so far (SPEC 4.10). */
export const PLAN_PROGRESS = { done: 4000, planned: 10000 };

export const PLAN_LINES: readonly PlanLine[] = [
  { label: 'Money in', plan: 7000, actual: 7000, kind: 'in' },
  { label: 'Labor', plan: 2200, actual: 2875, kind: 'cost' },
  { label: 'Materials', plan: 1800, actual: 1900, kind: 'cost' },
  { label: 'Time not on a job', plan: 200, actual: 260, kind: 'cost' },
  { label: 'Other costs', plan: 1000, actual: 400, kind: 'cost' },
];

export const PLAN_HOURS = { plan: 100, actual: 125 };

function profitOf(pick: (line: PlanLine) => number): number {
  return PLAN_LINES.reduce((sum, line) => sum + (line.kind === 'in' ? pick(line) : -pick(line)), 0);
}

export const PLAN_PROFIT = { plan: profitOf((line) => line.plan), actual: profitOf((line) => line.actual) };

/** "Why profit changed": the gap between plan and actual, split by cause. The bars always add up. */
export const WHY_STEPS: readonly { readonly label: string; readonly amount: number }[] = [
  { label: 'Price', amount: 0 },
  { label: 'Labor rate', amount: -125 },
  { label: 'Labor efficiency', amount: -550 },
  { label: 'Scrap', amount: -90 },
  { label: 'Material', amount: -10 },
  { label: 'Time not on a job', amount: -60 },
  { label: 'Other', amount: 600 },
];

export const WHY_READING =
  'Labor efficiency: the crew needed 25 more hours than planned for this many units. That cost $550.';

/* ===== Real cost of an hour ===== */

/** Packer: wage $16.00, payroll taxes 9%, benefits 12%, overhead $2.40 an hour (SPEC 4.3). */
export const RATE = {
  laborClass: 'Packer',
  wage: 16,
  taxPercent: 9,
  benefitPercent: 12,
  overhead: 2.4,
  overtimeMultiplier: 1.5,
} as const;

const cents = (dollars: number) => Math.round(dollars * 100) / 100;

export const RATE_PARTS: readonly {
  readonly label: string;
  readonly detail: string;
  readonly amount: number;
}[] = [
  { label: 'Wage', detail: 'What the paycheck says', amount: RATE.wage },
  {
    label: 'Payroll taxes',
    detail: `${RATE.taxPercent}% of the wage`,
    amount: cents((RATE.wage * RATE.taxPercent) / 100),
  },
  {
    label: 'Benefits',
    detail: `${RATE.benefitPercent}% of the wage`,
    amount: cents((RATE.wage * RATE.benefitPercent) / 100),
  },
  { label: 'Overhead', detail: 'Rent, power and the rest, per hour', amount: RATE.overhead },
];

/** $21.76. */
export const REAL_HOUR = cents(RATE_PARTS.reduce((sum, part) => sum + part.amount, 0));

/** $30.48. Payroll taxes grow with overtime pay. Benefits and overhead do not. */
export const OVERTIME_HOUR = cents(
  RATE.wage * RATE.overtimeMultiplier * (1 + RATE.taxPercent / 100) +
    (RATE.wage * RATE.benefitPercent) / 100 +
    RATE.overhead,
);

/** 12 packers, 8 hours each, 4 of the hours overtime: 96 labor hours, $2,123.84. */
export const CREW_DAY = { people: 12, hoursEach: 8, overtimeHours: 4 } as const;
export const CREW_DAY_HOURS = CREW_DAY.people * CREW_DAY.hoursEach;
export const CREW_DAY_COST = cents(
  (CREW_DAY_HOURS - CREW_DAY.overtimeHours) * REAL_HOUR + CREW_DAY.overtimeHours * OVERTIME_HOUR,
);

/** Standard material cost: 3,000 good units and 60 scrap at $0.45 a unit (SPEC 4.6). */
export const MATERIAL = { goodUnits: 3000, scrapUnits: 60, unitCost: 0.45 } as const;
export const MATERIAL_COST = cents((MATERIAL.goodUnits + MATERIAL.scrapUnits) * MATERIAL.unitCost);
export const MATERIAL_SCRAP_COST = cents(MATERIAL.scrapUnits * MATERIAL.unitCost);

/* ===== CSV ===== */

/** The 17 kinds of data that come in and go out as CSV, each with its own template. */
export const CSV_STREAMS: readonly string[] = [
  'Clients',
  'Job types',
  'Jobs',
  'Quotes and budgets',
  'Production',
  'Labor rates',
  'Other time',
  'Paid hours',
  'Time punches',
  'Materials',
  'Items',
  'Costs',
  'Revenue',
  'Services',
  'Service entries',
  'Target pace',
  'Goals',
];

/** The Check step of an import: what the file would do before anything is saved. */
export const CSV_CHECK: readonly {
  readonly label: string;
  readonly rows: number;
  readonly isProblem?: true;
}[] = [
  { label: 'New', rows: 193 },
  { label: 'Changed', rows: 9 },
  { label: 'Unchanged', rows: 7 },
  { label: 'Possible repeats', rows: 4 },
  { label: 'Skipped', rows: 0 },
  { label: 'Errors', rows: 1, isProblem: true },
];
export const CSV_ROWS = CSV_CHECK.reduce((sum, item) => sum + item.rows, 0);

export const CSV_FILE = 'production-november.csv';
export const CSV_PROBLEM = {
  row: 14,
  column: 'labor_hours',
  value: '9x',
  message: '9x is not a number.',
} as const;

/** Three rows of the file as the preview shows them. Row 14 holds the problem cell. */
export const CSV_PREVIEW: readonly {
  readonly row: number;
  readonly workDate: string;
  readonly job: string;
  readonly units: string;
  readonly hours: string;
}[] = [
  { row: 13, workDate: '2026-11-16', job: 'J-1005', units: '4,180', hours: '96' },
  { row: 14, workDate: '2026-11-16', job: 'J-1012', units: '720', hours: CSV_PROBLEM.value },
  { row: 15, workDate: '2026-11-16', job: 'J-1023', units: '1,480', hours: '40' },
];
