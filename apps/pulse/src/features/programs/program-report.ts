/**
 * The monthly program report (docs/programs/PULSE_PROGRAMS_SPEC.md 7.4), built from the same
 * reads the program page shows (Overview, By variant, Days), so its totals equal the page to the
 * cent. Two versions:
 *
 * - `internal`: totals (kits, revenue, labor, material, profit, margin against the customer's
 *   target), By variant, By day, and notes on the minimum and the alerts that fired.
 * - `customer`: the same header, kits built against planned by variant and by day, revenue by
 *   variant, fees and the minimum. It never holds a cost, labor, profit or margin, not even as a
 *   hidden column: those values are never put in it.
 *
 * Pure: the report route turns it into JSON, CSV, a page to print and a PDF, and the dialog
 * previews it with the report table.
 */
import { formatMoney } from '@/lib/format';
import { ratioBp } from '@/lib/money';
import type { ProgramDaysDTO, ProgramMonthDTO, ProgramVariantRowDTO, ProgramVariantsDTO } from '@/lib/program-types';
import type { ReportCell, ReportCellKind, ReportColumnDTO, ReportRowDTO } from '@/lib/types';
import { capitalize, dayLabel, monthLabel, sumMoney, sumQuantities } from './program-format';

export const PROGRAM_REPORT_VERSIONS = ['internal', 'customer'] as const;
export type ProgramReportVersion = (typeof PROGRAM_REPORT_VERSIONS)[number];

export const PROGRAM_REPORT_VERSION_LABELS: Readonly<Record<ProgramReportVersion, string>> = {
  internal: 'Internal',
  customer: 'For the customer',
};

/** What the dialog says about each version. */
export const PROGRAM_REPORT_VERSION_HINTS: Readonly<Record<ProgramReportVersion, string>> = {
  internal: 'For your team: revenue, labor, material, profit and margin against the customer target.',
  customer: 'Cost and margin are left out.',
};

export const OPEN_MONTH_NOTE = 'Month still open. Numbers can change.';
export const FINAL_MONTH_NOTE = 'Final. This month is closed.';

export interface ProgramReportTable {
  readonly id: 'variants' | 'days' | 'fees';
  readonly title: string;
  readonly columns: readonly ReportColumnDTO[];
  readonly rows: readonly ReportRowDTO[];
  readonly total: Readonly<Record<string, ReportCell>> | null;
}

export interface ProgramReportSummaryItem {
  readonly key: string;
  readonly label: string;
  readonly value: ReportCell;
  readonly kind: ReportCellKind;
  /** A short line under the value ("Target 30% for this customer"). */
  readonly note?: string;
}

/** `GET /api/v1/programs/[key]/report?month=&version=`. */
export interface ProgramReportDTO {
  readonly version: ProgramReportVersion;
  readonly versionLabel: string;
  readonly key: string;
  readonly name: string;
  readonly customerName: string | null;
  readonly month: string;
  readonly monthLabel: string;
  /** "Price card v2", or null when no card is in force. */
  readonly cardLabel: string | null;
  /** The month is closed in Pulse: the report prints as final. */
  readonly final: boolean;
  /** "Final. This month is closed." or "Month still open. Numbers can change." */
  readonly statusNote: string;
  /** "GLOVE monthly report". */
  readonly title: string;
  /** "Glove kitting, Gripwell Safety Supply, November 2026". */
  readonly subtitle: string;
  readonly unitPlural: string;
  readonly summary: readonly ProgramReportSummaryItem[];
  readonly tables: readonly ProgramReportTable[];
  readonly notes: readonly string[];
  /** The reader may not see money: revenue is left out too. */
  readonly moneyHidden: boolean;
  readonly generatedAt: string;
}

export interface ProgramReportInput {
  readonly month: ProgramMonthDTO;
  readonly variants: ProgramVariantsDTO;
  readonly days: ProgramDaysDTO;
}

const num = (value: string | null | undefined): number | null => (value === null || value === undefined || value === '' ? null : Number(value));

/** Column words and kinds, shared by both versions so the two read the same. */
function col(key: string, label: string, kind: ReportCellKind, money = false): ReportColumnDTO {
  return { key, label, kind, money };
}

const FEE_WORDS: Readonly<Record<string, string>> = {
  fee: 'Program fee',
  adjustment: 'Adjustment',
  minimum: 'Minimum top up',
  minimum_topup: 'Minimum top up',
  credit: 'Credit',
};

/** Words for a fee kind ("Program fee"). */
export function feeKindLabel(kind: string): string {
  return FEE_WORDS[kind] ?? capitalize(kind.replace(/_/g, ' '));
}

/** A variant row has something to say this month. */
const hasNumbers = (row: ProgramVariantRowDTO): boolean => Number(row.units) !== 0 || Number(row.scrap) !== 0 || (row.revenueCents ?? 0) !== 0 || (row.costCents ?? 0) !== 0 || Number(row.hours) !== 0;

/** Other and shared cost of a row, so labor, material and this add up to the cost. */
const otherCost = (row: { readonly otherCents: number | null; readonly sharedCents: number | null }): number | null => sumMoney([row.otherCents, row.sharedCents]);

function minimumNote(input: ProgramReportInput, version: ProgramReportVersion): string | null {
  const { month } = input;
  const plan = month.plan;
  if (!plan || plan.minimumCents === null) return null;
  const minimum = formatMoney(plan.minimumCents);
  if (month.month.when !== 'current') {
    const revenue = month.figures.revenueCents ?? 0;
    // A closed or past month: the minimum top up, if any, is already in the fees.
    const topUp = input.variants.fees.byKind.find((row) => row.kind === 'minimum' || row.kind === 'minimum_topup');
    if (topUp && (topUp.cents ?? 0) > 0) return `Revenue was under the ${minimum} monthly minimum, so a minimum top up of ${formatMoney(topUp.cents)} was charged.`;
    return revenue >= plan.minimumCents ? `The ${minimum} monthly minimum was met.` : `Revenue is under the ${minimum} monthly minimum.`;
  }
  if ((plan.projectedGapCents ?? 0) > 0) {
    return version === 'internal' ? `May miss the ${minimum} minimum by ${formatMoney(plan.projectedGapCents)}.` : `The monthly minimum is ${minimum}. The month is on pace to come in under it.`;
  }
  return `The monthly minimum is ${minimum}. The month is on pace to meet it.`;
}

function variantTable(input: ProgramReportInput, version: ProgramReportVersion): ProgramReportTable {
  const { variants } = input;
  const money = !variants.moneyHidden;
  const internal = version === 'internal';
  const columns: ReportColumnDTO[] = [
    col('name', 'Variant', 'text'),
    col('planned', 'Planned', 'number'),
    col('built', 'Built', 'number'),
    col('scrap', 'Scrap', 'number'),
    ...(money ? [col('revenue', 'Revenue', 'money', true)] : []),
    ...(money && internal ? [col('labor', 'Labor', 'money', true), col('material', 'Material', 'money', true), col('other', 'Other cost', 'money', true), col('profit', 'Profit', 'money', true), col('margin', 'Margin', 'percent', true)] : []),
    ...(money && !internal ? [col('share', 'Share of revenue', 'percent', true)] : []),
  ];
  const cells = (row: ProgramVariantRowDTO, name: string): Record<string, ReportCell> => ({
    name,
    planned: num(row.plannedUnits),
    built: num(row.units),
    scrap: num(row.scrap),
    ...(money ? { revenue: row.revenueCents } : {}),
    ...(money && internal ? { labor: row.laborCents, material: row.materialCents, other: otherCost(row), profit: row.profitCents, margin: row.marginBp } : {}),
    ...(money && !internal ? { share: row.revenueShareBp } : {}),
  });
  const rows: ReportRowDTO[] = variants.variants.map((row) => ({ id: row.variantId ?? row.name, cells: cells(row, row.sku ? `${row.name} (${row.sku})` : row.name) }));
  if (money && (variants.fees.totalCents ?? 0) !== 0) {
    const share = variants.total.revenueCents ? ratioBp(variants.fees.totalCents ?? 0, variants.total.revenueCents) : null;
    rows.push({ id: 'fees', cells: { name: 'Program fees', planned: null, built: null, scrap: null, revenue: variants.fees.totalCents, ...(internal ? { labor: null, material: null, other: null, profit: variants.fees.totalCents, margin: null } : { share }) } });
  }
  if (hasNumbers(variants.notTiedToVariant) && (internal || Number(variants.notTiedToVariant.units) !== 0 || (variants.notTiedToVariant.revenueCents ?? 0) !== 0)) {
    rows.push({ id: 'not-tied', cells: cells(variants.notTiedToVariant, 'Not tied to a variant') });
  }
  const total = variants.total;
  const plannedTotal = sumQuantities(variants.variants.map((row) => row.plannedUnits));
  return {
    id: 'variants',
    title: 'By variant',
    columns,
    rows,
    total: {
      name: 'Total',
      planned: num(plannedTotal),
      built: num(total.units),
      scrap: num(total.scrap),
      ...(money ? { revenue: total.revenueCents } : {}),
      ...(money && internal ? { labor: total.laborCents, material: total.materialCents, other: otherCost(total), profit: total.profitCents, margin: total.marginBp } : {}),
      ...(money && !internal ? { share: total.revenueCents ? 10000 : null } : {}),
    },
  };
}

function dayTable(input: ProgramReportInput, version: ProgramReportVersion): ProgramReportTable {
  const { days, month } = input;
  const money = !days.moneyHidden;
  const internal = version === 'internal';
  const columns: ReportColumnDTO[] = [
    col('day', 'Day', 'text'),
    col('planned', 'Planned', 'number'),
    col('built', 'Built', 'number'),
    col('scrap', 'Scrap', 'number'),
    ...(internal ? [col('hours', 'Hours', 'hours')] : []),
    ...(money && internal ? [col('revenue', 'Revenue', 'money', true), col('cost', 'Cost', 'money', true), col('profit', 'Profit', 'money', true)] : []),
  ];
  const rows: ReportRowDTO[] = days.days
    // The customer copy lists the days with work planned or built; fee only days are in the fees.
    .filter((day) => internal || Number(day.plannedUnits) !== 0 || Number(day.units) !== 0 || Number(day.scrap) !== 0)
    .map((day) => {
      // A day off reads blank where nothing happened, so its fees stand out.
      const quiet = (value: string): number | null => (!day.workDay && Number(value) === 0 ? null : num(value));
      return {
      id: day.date,
      cells: {
        day: `${dayLabel(day.date)}${day.workDay ? '' : ' (day off)'}`,
        planned: quiet(day.plannedUnits),
        // A day still ahead has its plan and nothing built yet.
        built: day.date > month.month.asOf ? null : quiet(day.units),
        scrap: day.date > month.month.asOf ? null : quiet(day.scrap),
        ...(internal ? { hours: day.date > month.month.asOf ? null : quiet(day.hours) } : {}),
        ...(money && internal ? (day.date > month.month.asOf && !day.revenueCents && !day.costCents ? { revenue: null, cost: null, profit: null } : { revenue: day.revenueCents, cost: day.costCents, profit: day.profitCents }) : {}),
      },
      };
    });
  return {
    id: 'days',
    title: 'By day',
    columns,
    rows,
    total: {
      day: 'Total',
      planned: num(sumQuantities(days.days.map((day) => day.plannedUnits))),
      built: num(month.figures.units),
      scrap: num(month.figures.scrap),
      ...(internal ? { hours: num(month.figures.hours) } : {}),
      ...(money && internal ? { revenue: month.figures.revenueCents, cost: month.figures.costCents, profit: month.figures.profitCents } : {}),
    },
  };
}

function feeTable(input: ProgramReportInput): ProgramReportTable | null {
  const { variants } = input;
  if (variants.moneyHidden || variants.fees.byKind.length === 0) return null;
  return {
    id: 'fees',
    title: 'Fees',
    columns: [col('kind', 'Fee', 'text'), col('amount', 'Amount', 'money', true)],
    rows: variants.fees.byKind.map((row) => ({ id: row.kind, cells: { kind: feeKindLabel(row.kind), amount: row.cents } })),
    total: { kind: 'Total', amount: variants.fees.totalCents },
  };
}

/** Builds one version of the report from the program page reads of the same month. */
export function buildProgramReport(input: ProgramReportInput, version: ProgramReportVersion, options: { readonly generatedAt?: string } = {}): ProgramReportDTO {
  const { month } = input;
  const header = month.header;
  const figures = month.figures;
  const money = !month.moneyHidden;
  const internal = version === 'internal';
  const unit = header.unit;
  const customer = header.customerName ?? header.client?.name ?? null;
  const target = month.target.targetMarginBp;
  const plannedUnits = month.plan?.plannedUnits ?? sumQuantities(input.variants.variants.map((row) => row.plannedUnits));

  const summary: ProgramReportSummaryItem[] = [
    { key: 'built', label: `${capitalize(unit.plural)} built`, value: num(figures.units), kind: 'number' },
    { key: 'planned', label: 'Planned', value: num(plannedUnits), kind: 'number' },
  ];
  if (money) summary.push({ key: 'revenue', label: 'Revenue', value: figures.revenueCents, kind: 'money' });
  if (money && internal) {
    summary.push(
      { key: 'labor', label: 'Labor', value: figures.laborCents, kind: 'money' },
      { key: 'material', label: 'Material', value: figures.materialCents, kind: 'money' },
    );
    const other = otherCost(figures);
    if ((other ?? 0) !== 0) summary.push({ key: 'other', label: 'Other cost', value: other, kind: 'money' });
    summary.push(
      { key: 'profit', label: 'Profit', value: figures.profitCents, kind: 'money' },
      { key: 'margin', label: 'Margin', value: figures.marginBp, kind: 'percent', note: target === null ? undefined : `Target ${Math.round(target / 100)}% for this customer` },
    );
  }
  if (internal) summary.push({ key: 'hours', label: 'Labor hours', value: num(figures.hours), kind: 'hours' });
  if (money && !internal) {
    summary.push({ key: 'fees', label: 'Program fees', value: figures.feeCents, kind: 'money' });
    if (month.plan?.minimumCents !== null && month.plan?.minimumCents !== undefined) summary.push({ key: 'minimum', label: 'Monthly minimum', value: month.plan.minimumCents, kind: 'money' });
  }

  const notes: string[] = [];
  if (money) {
    const minimum = minimumNote(input, version);
    if (minimum) notes.push(minimum);
  }
  if (internal) {
    if (month.alerts.length === 0) notes.push('No alerts fired this month.');
    for (const alert of month.alerts) notes.push(`Alert: ${alert.sentence}`);
  }
  if (!money) notes.push('Money is left out of this copy.');

  const tables = [variantTable(input, version), dayTable(input, version), ...(internal ? [] : [feeTable(input)].filter((table): table is ProgramReportTable => table !== null))];
  const final = month.month.closed;
  const label = monthLabel(month.month.month);
  return {
    version,
    versionLabel: PROGRAM_REPORT_VERSION_LABELS[version],
    key: header.key,
    name: header.name,
    customerName: customer,
    month: month.month.month,
    monthLabel: label,
    cardLabel: header.cardVersion === null ? null : `Price card v${header.cardVersion}`,
    final,
    statusNote: final ? FINAL_MONTH_NOTE : OPEN_MONTH_NOTE,
    title: `${header.key} monthly report`,
    subtitle: [header.name, customer, label].filter(Boolean).join(', '),
    unitPlural: unit.plural,
    summary,
    tables,
    notes,
    moneyHidden: !money,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  };
}

/** The file name of a download: `glove-2026-11-internal.csv`. */
export function programReportFileName(report: Pick<ProgramReportDTO, 'key' | 'month' | 'version'>, extension: 'csv' | 'pdf' | 'html'): string {
  return `${report.key.toLowerCase()}-${report.month}-${report.version === 'customer' ? 'customer' : 'internal'}.${extension}`;
}
