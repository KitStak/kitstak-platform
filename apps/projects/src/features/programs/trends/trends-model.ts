/**
 * Pure model for the Trends layout (docs/programs/SPEC.md 5.19): the last 12 months, programs
 * grouped by customer with a subtotal row, a totals row by unit label, and cell text
 * "14,172 kits · $29,970" (units only without money access). Unit tested.
 */
import { formatCents, fromScaled, quantityToScaled, unitLabel } from '@kitstak/programs-engine';
import type { IsoMonth, TrendsDTO, UnitLabel } from '@/lib/program-types';

export type TrendsMetric = 'units' | 'revenue' | 'both';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 2026" (or "Nov" when `short`). */
export function monthLabel(month: IsoMonth, short = false): string {
  const [year, m] = month.split('-');
  const name = MONTHS[Number(m) - 1] ?? month;
  return short ? name : `${name} ${year}`;
}

/** The month `n` months away from `month`. */
export function shiftMonth(month: IsoMonth, n: number): IsoMonth {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The 12 months ending at `to`. */
export function last12(to: IsoMonth): { readonly from: IsoMonth; readonly to: IsoMonth } {
  return { from: shiftMonth(to, -11), to };
}

const qty = (value: string | null | undefined): bigint => {
  if (!value) return BigInt(0);
  try {
    return quantityToScaled(value);
  } catch {
    return BigInt(0);
  }
};
const cents = (value: string | null | undefined): bigint => {
  if (!value) return BigInt(0);
  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
};

export interface TrendsCell {
  readonly month: IsoMonth;
  readonly units: string;
  readonly revenueCents: string | null;
}

export interface TrendsLine {
  readonly kind: 'program' | 'subtotal' | 'total';
  readonly id: string;
  readonly key: string | null;
  readonly name: string;
  /** Null for a total line that mixes unit labels (then `unitTotals` holds each label). */
  readonly unit: UnitLabel | null;
  readonly cells: readonly TrendsCell[];
  readonly totalUnits: string;
  readonly totalCents: string | null;
  readonly moneyHidden: boolean;
}

export interface TrendsGroup {
  readonly id: string;
  readonly name: string;
  readonly programs: readonly TrendsLine[];
  /** Present when the group has more than one program. */
  readonly subtotal: TrendsLine | null;
}

export interface TrendsTable {
  readonly months: readonly IsoMonth[];
  readonly groups: readonly TrendsGroup[];
  /** One totals line per unit label (never added across labels). */
  readonly totals: readonly TrendsLine[];
}

interface ProgramInfo {
  readonly customer: { readonly id: string; readonly name: string } | null;
  readonly unit: UnitLabel;
}

function sumLines(id: string, name: string, kind: 'subtotal' | 'total', months: readonly IsoMonth[], lines: readonly TrendsLine[], unit: UnitLabel | null): TrendsLine {
  const hidden = lines.some((line) => line.moneyHidden);
  const cells = months.map((month, index) => {
    let units = BigInt(0);
    let money = BigInt(0);
    for (const line of lines) {
      units += qty(line.cells[index]?.units);
      money += cents(line.cells[index]?.revenueCents);
    }
    return { month, units: fromScaled(units, 3), revenueCents: hidden ? null : money.toString() };
  });
  return {
    kind,
    id,
    key: null,
    name,
    unit,
    cells,
    totalUnits: fromScaled(lines.reduce((total, line) => total + qty(line.totalUnits), BigInt(0)), 3),
    totalCents: hidden ? null : lines.reduce((total, line) => total + cents(line.totalCents), BigInt(0)).toString(),
    moneyHidden: hidden,
  };
}

/** Groups rows by customer (no customer last) with subtotals, and totals per unit label. */
export function trendsTable(data: TrendsDTO, info: ReadonlyMap<string, ProgramInfo>): TrendsTable {
  const lines: (TrendsLine & { customer: ProgramInfo['customer'] })[] = data.rows.map((row) => {
    const known = info.get(row.id);
    const unit = known?.unit ?? { singular: row.unit, plural: row.unit };
    return {
      kind: 'program',
      id: row.id,
      key: row.key,
      name: row.name,
      unit,
      cells: data.months.map((month) => {
        const cell = row.cells.find((entry) => entry.month === month);
        return { month, units: cell?.units ?? '0.000', revenueCents: row.moneyHidden ? null : (cell?.revenueCents ?? '0') };
      }),
      totalUnits: row.totalUnits,
      totalCents: row.moneyHidden ? null : row.totalCents,
      moneyHidden: row.moneyHidden,
      customer: known?.customer ?? null,
    };
  });
  const byCustomer = new Map<string, { id: string; name: string; programs: TrendsLine[] }>();
  for (const line of lines) {
    const id = line.customer?.id ?? 'none';
    const group = byCustomer.get(id) ?? { id, name: line.customer?.name ?? 'No customer', programs: [] };
    group.programs.push(line);
    byCustomer.set(id, group);
  }
  const groups = [...byCustomer.values()]
    .sort((a, b) => (a.id === 'none' ? 1 : b.id === 'none' ? -1 : a.name.localeCompare(b.name)))
    .map((group) => {
      const programs = [...group.programs].sort((a, b) => a.name.localeCompare(b.name));
      const units = new Set(programs.map((line) => line.unit?.plural.toLowerCase()));
      return {
        id: group.id,
        name: group.name,
        programs,
        subtotal: programs.length > 1 ? sumLines(`subtotal:${group.id}`, `${group.name} total`, 'subtotal', data.months, programs, units.size === 1 ? programs[0]!.unit : null) : null,
      };
    });
  const byUnit = new Map<string, TrendsLine[]>();
  for (const line of lines) {
    const key = line.unit?.plural.toLowerCase() ?? '';
    byUnit.set(key, [...(byUnit.get(key) ?? []), line]);
  }
  const totals = [...byUnit.values()].map((group) => sumLines(`total:${group[0]!.unit?.plural ?? ''}`, byUnit.size > 1 ? `Total ${group[0]!.unit?.plural ?? ''}` : 'Total', 'total', data.months, group, group[0]!.unit));
  return { months: data.months, groups, totals };
}

/** "14,172 kits · $29,970", the units or the money alone, by metric. */
export function cellText(cell: TrendsCell, unit: UnitLabel | null, metric: TrendsMetric): { readonly units: string; readonly money: string | null } {
  const units = unit ? unitLabel(cell.units, unit) : fromScaled(qty(cell.units), 0);
  const money = cell.revenueCents === null ? null : formatCents(cell.revenueCents);
  if (metric === 'units' || money === null) return { units, money: null };
  if (metric === 'revenue') return { units: '', money };
  return { units, money };
}

/** True when the cell has nothing (shown as a quiet dash free "None"). */
export function emptyCell(cell: TrendsCell): boolean {
  return qty(cell.units) === BigInt(0) && cents(cell.revenueCents) === BigInt(0);
}
