/**
 * The one quote function (docs/billing/CONTRACTS.md section 4.3). PURE. The total is plain
 * `sum(unit amount x quantity)` with the unit amounts the gateway charges, so the quote and the invoice
 * cannot differ by a cent.
 */
import {
  CATALOG,
  type BillingInterval,
  formatMoney,
  isBundle,
  normalizeSelection,
  percentLabel,
  type PlanSelection,
  type PriceKey,
  priceKey,
  type ProductId,
  quantityFor,
  seatLimitFor,
  unitCents,
} from './catalog';

export interface QuoteLine {
  readonly product: ProductId;
  readonly name: string;
  readonly quantity: number;
  /** 'user' | 'users' | 'warehouse' | ... matched to quantity. */
  readonly unitLabel: string;
  /** The public monthly list price for one unit. */
  readonly listUnitMonthlyCents: number;
  /** What the gateway charges per unit per period. */
  readonly unitCents: number;
  /** unitCents x quantity. */
  readonly amountCents: number;
  readonly priceKey: PriceKey;
  /** 'CRM: 5 users x $29 = $145 per month'. Pulse: 'Pulse: $29 per month for your whole team, up to 5 seats'. */
  readonly math: string;
}

export interface Quote {
  /** Normalized. */
  readonly selection: PlanSelection;
  readonly interval: BillingInterval;
  readonly periodMonths: 1 | 12;
  readonly isBundle: boolean;
  readonly lines: readonly QuoteLine[];
  /** sum(list monthly x quantity) x periodMonths. */
  readonly listPeriodCents: number;
  /** 0 on monthly. */
  readonly yearlySavingsCents: number;
  /** 0 without a bundle. */
  readonly bundleSavingsCents: number;
  /** Per period, before tax = sum(lines.amountCents). */
  readonly totalCents: number;
  /** totalCents / periodMonths, exact. */
  readonly monthlyEquivalentCents: number;
  readonly seatLimit: number | null;
  /** Set when seats are above what Pulse covers: 'The Pulse price covers up to 5 seats.' else null. */
  readonly pulseSeatNote: string | null;
}

function mathLine(product: ProductId, quantity: number, unitLabel: string): string {
  const pricing = CATALOG.products[product];
  const list = formatMoney(pricing.cents.monthly, { trimZeroCents: true });
  if (pricing.quantityFrom === 'flat') {
    const seats = pricing.includedSeats === null ? '' : `, up to ${pricing.includedSeats} seats`;
    return `${pricing.shortName}: ${list} per month for your whole team${seats}`;
  }
  const amount = formatMoney(pricing.cents.monthly * quantity, { trimZeroCents: true });
  return `${pricing.shortName}: ${quantity} ${unitLabel} x ${list} = ${amount} per month`;
}

/** Pure. Identity: listPeriodCents - yearlySavingsCents - bundleSavingsCents === totalCents. */
export function quote(selection: PlanSelection): Quote {
  const normalized = normalizeSelection(selection);
  const bundle = isBundle(normalized.products);
  const periodMonths: 1 | 12 = normalized.interval === 'yearly' ? 12 : 1;

  let listMonthlyCents = 0;
  let beforeBundleCents = 0;
  const lines: QuoteLine[] = normalized.products.map((product) => {
    const pricing = CATALOG.products[product];
    const quantity = quantityFor(product, normalized);
    const unitLabel = quantity === 1 ? pricing.unit : pricing.unitPlural;
    const unit = unitCents(product, normalized.interval, bundle);
    listMonthlyCents += pricing.cents.monthly * quantity;
    beforeBundleCents += unitCents(product, normalized.interval, false) * quantity;
    return {
      product,
      name: pricing.name,
      quantity,
      unitLabel,
      listUnitMonthlyCents: pricing.cents.monthly,
      unitCents: unit,
      amountCents: unit * quantity,
      priceKey: priceKey(product, normalized.interval, bundle),
      math: mathLine(product, quantity, unitLabel),
    };
  });

  const listPeriodCents = listMonthlyCents * periodMonths;
  const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const pulseIncluded = CATALOG.products.pulse.includedSeats;
  const pulseSeatNote =
    normalized.products.includes('pulse') && pulseIncluded !== null && normalized.seats > pulseIncluded
      ? `The Pulse price covers up to ${pulseIncluded} seats.`
      : null;

  return {
    selection: normalized,
    interval: normalized.interval,
    periodMonths,
    isBundle: bundle,
    lines,
    listPeriodCents,
    yearlySavingsCents: listPeriodCents - beforeBundleCents,
    bundleSavingsCents: beforeBundleCents - totalCents,
    totalCents,
    monthlyEquivalentCents: totalCents / periodMonths,
    seatLimit: seatLimitFor(normalized),
    pulseSeatNote,
  };
}

/** The summary lines under the math, in order: list, yearly discount, bundle discount, total. */
export function quoteSummaryLines(
  q: Quote,
): readonly { label: string; amountCents: number; kind: 'list' | 'discount' | 'total' }[] {
  const out: { label: string; amountCents: number; kind: 'list' | 'discount' | 'total' }[] = [
    {
      label: q.periodMonths === 12 ? 'List price for 12 months' : 'List price',
      amountCents: q.listPeriodCents,
      kind: 'list',
    },
  ];
  if (q.yearlySavingsCents > 0) {
    out.push({
      label: `Yearly discount (${percentLabel(CATALOG.yearlyPercentOff)})`,
      amountCents: -q.yearlySavingsCents,
      kind: 'discount',
    });
  }
  if (q.bundleSavingsCents > 0) {
    out.push({
      label: `Bundle discount (${percentLabel(CATALOG.bundlePercentOff)})`,
      amountCents: -q.bundleSavingsCents,
      kind: 'discount',
    });
  }
  out.push({
    label: q.periodMonths === 12 ? 'Total per year' : 'Total per month',
    amountCents: q.totalCents,
    kind: 'total',
  });
  return out;
}
