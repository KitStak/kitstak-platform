/**
 * The GLOVE program used by the engine tests (docs/programs/SPEC.md 3.15): Size Small, Medium,
 * Large, XL x Color Brown, Yellow (8 variants); card v1 from 2026-09-15 at $1.85 a kit with
 * "Size is XL: set $2.10"; card v2 from 2026-11-01 at $1.95 with "Size is XL: add $0.25"; a
 * $1,500.00 monthly fee and a $30,000.00 monthly minimum, both charged in part in a partial
 * month; a $2,500.00 setup fee on 2026-09-15; Monday to Friday with 2026-11-26 off; Chicago.
 */
import { accrueDay } from './accrual';
import { compileRateRules, resolveUnitPrice } from './price';
import type { AttributeAxis } from './variants';
import type { CardLine, CardVersion, IsoDate, OneTimeCharge, OutputRow, ProgramCalendar, RateRule } from './types';

export const PROGRAM_ID = 'glove';

export const AXES: readonly AttributeAxis[] = [
  {
    id: 'size',
    name: 'Size',
    values: [
      { id: 'size-s', label: 'Small', code: 'S' },
      { id: 'size-m', label: 'Medium', code: 'M' },
      { id: 'size-l', label: 'Large', code: 'L' },
      { id: 'size-xl', label: 'XL', code: 'XL' },
    ],
  },
  {
    id: 'color',
    name: 'Color',
    values: [
      { id: 'color-brn', label: 'Brown', code: 'BRN' },
      { id: 'color-ylw', label: 'Yellow', code: 'YLW' },
    ],
  },
];

export interface FixtureVariant {
  readonly id: string;
  readonly name: string;
  readonly key: string;
  readonly sku: string;
  readonly attributes: Readonly<Record<string, string>>;
}

export const VARIANTS: readonly FixtureVariant[] = AXES[0]!.values.flatMap((size) =>
  AXES[1]!.values.map((color) => ({
    id: `v-${size.code}-${color.code}`,
    name: `${size.label} ${color.label}`,
    key: `${size.code}-${color.code}`,
    sku: `GLOVE-${size.code}-${color.code}`,
    attributes: { size: size.id, color: color.id },
  })),
);

export function line(partial: Partial<CardLine> & Pick<CardLine, 'id' | 'kind'>): CardLine {
  return { variantId: null, ruleId: null, unitPrice: null, rateCents: null, amountCents: null, prorate: true, chargeWhilePaused: true, label: null, ...partial };
}

function version(id: string, number: number, effectiveFrom: IsoDate, unitPrice: string, rule: RateRule): CardVersion {
  const compiled = compileRateRules({ defaultUnitPrice: unitPrice, rules: [rule], variants: VARIANTS, handLines: [] });
  return {
    id,
    number,
    effectiveFrom,
    rules: [rule],
    lines: [
      line({ id: `${id}-unit`, kind: 'per_unit', unitPrice }),
      ...compiled.lines.map((row) => line({ id: `${id}-${row.variantId}`, kind: 'per_unit', variantId: row.variantId, ruleId: row.ruleId, unitPrice: row.unitPrice })),
      line({ id: `${id}-fee`, kind: 'flat_monthly', amountCents: '150000' }),
      line({ id: `${id}-min`, kind: 'monthly_minimum', amountCents: '3000000' }),
    ],
  };
}

export const V1 = version('v1', 1, '2026-09-15', '1.85', { id: 'r1', attributeId: 'size', valueId: 'size-xl', op: 'set', amount: '2.10' });
export const V2 = version('v2', 2, '2026-11-01', '1.95', { id: 'r2', attributeId: 'size', valueId: 'size-xl', op: 'add', amount: '0.25' });
export const VERSIONS: readonly CardVersion[] = [V1, V2];

export const SETUP: OneTimeCharge = { id: 'setup-1', kind: 'setup', chargeOn: '2026-09-15', amountCents: '250000', label: 'Setup fee', variantId: null, countsTowardMinimum: false };

export const CALENDAR: ProgramCalendar = {
  timezone: 'America/Chicago',
  workingDays: [1, 2, 3, 4, 5],
  daysOff: ['2026-11-26', '2026-12-25'],
  extraWorkDays: [],
  activeFrom: '2026-09-15',
  activeTo: null,
  paused: [],
};

/** A calendar active all month with no days off, for fixed line cases. */
export const OPEN_CALENDAR: ProgramCalendar = { ...CALENDAR, daysOff: [], activeFrom: null };

/** One output row per variant for each date, priced and stamped the way the domain does it. */
export function outputFor(dates: readonly IsoDate[], qtyFor: (date: IsoDate, variant: FixtureVariant) => string = () => '100', versions: readonly CardVersion[] = VERSIONS): OutputRow[] {
  return dates.flatMap((date) =>
    VARIANTS.map((variant) => {
      const qty = qtyFor(date, variant);
      const price = resolveUnitPrice({ workDate: date, variantId: variant.id, buildOverride: null, versions });
      return {
        buildId: `b-${variant.key}-${date}`,
        variantId: variant.id,
        workDate: date,
        qty,
        scrapQty: '0',
        unitPrice: price.unitPrice,
        priceSource: price.source,
        versionId: price.versionId,
        revenueCents: accrueDay(qty, price.unitPrice).toString(),
        posting: 'program' as const,
        pulseJobId: null,
      };
    }),
  );
}

/** A small seeded random number generator (mulberry32), so property tests repeat exactly. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
