/**
 * Material cost (docs/pulse/SPEC.md 4.6). Who buys the parts decides if a part costs anything:
 * parts the client owns cost 0 and still track quantity. Pure functions.
 */
import { type Cents, type Decimal, ZERO, divRound, priceToScaled, quantityToScaled, pow10, ratioBp } from '../money';
import type { PartsOwner } from './types';

type Owner = PartsOwner | null | undefined;

/** quantity x 1000 times price x 10000, divided by this, lands on whole cents. */
const TO_CENTS = pow10(5);

/**
 * Who pays for a part, resolved per usage row: the row, else the item, else the job, else the
 * client, else the org default.
 */
export function resolvePartsOwner(chain: { row?: Owner; item?: Owner; job?: Owner; client?: Owner; orgDefault: PartsOwner }): PartsOwner {
  return chain.row ?? chain.item ?? chain.job ?? chain.client ?? chain.orgDefault;
}

export interface StandardMaterialStamp {
  /** Cost of the material for good and scrapped units. */
  readonly stdMaterialCents: Cents;
  /** The scrap part of that cost. */
  readonly stdScrapCents: Cents;
}

/**
 * Standard method: `(units good + units scrap) x material cost per unit`, stamped on each
 * production entry. 3,000 good and 60 scrap at $0.45 is $1,377.00, of which $27.00 is scrap.
 */
export function standardMaterial(input: { unitsGood: Decimal; unitsScrap?: Decimal | null; materialCostPerUnit: Decimal | null | undefined }): StandardMaterialStamp {
  const blank = input.materialCostPerUnit === null || input.materialCostPerUnit === undefined || input.materialCostPerUnit === '';
  const price = priceToScaled(blank ? 0 : (input.materialCostPerUnit as Decimal));
  const good = quantityToScaled(input.unitsGood);
  const scrap = quantityToScaled(input.unitsScrap ?? 0);
  return { stdMaterialCents: divRound((good + scrap) * price, TO_CENTS), stdScrapCents: divRound(scrap * price, TO_CENTS) };
}

export interface ActualMaterialStamp {
  readonly costCents: Cents;
  readonly scrapCents: Cents;
}

/**
 * Actual method: `(quantity used + quantity scrapped) x unit cost` for a usage row that resolves
 * to `us`. A row that resolves to `client` costs 0.
 */
export function actualMaterial(input: { quantityUsed: Decimal; quantityScrapped?: Decimal | null; unitCost: Decimal; suppliedBy: PartsOwner }): ActualMaterialStamp {
  if (input.suppliedBy === 'client') return { costCents: ZERO, scrapCents: ZERO };
  const used = quantityToScaled(input.quantityUsed);
  const scrapped = quantityToScaled(input.quantityScrapped ?? 0);
  const price = priceToScaled(input.unitCost);
  return { costCents: divRound((used + scrapped) * price, TO_CENTS), scrapCents: divRound(scrapped * price, TO_CENTS) };
}

/** A usage row with a planned quantity, for the material still to buy. */
export interface PlannedUsageRow {
  readonly quantityPlanned: Decimal | null | undefined;
  readonly quantityUsed: Decimal;
  readonly quantityScrapped?: Decimal | null;
  readonly unitCost: Decimal;
  readonly suppliedBy: PartsOwner;
}

/**
 * Material still to come on an `actual` job with planned quantities (4.13): over our own usage
 * rows, `max(0, planned - used - scrapped) x unit cost`. `null` when no row has a planned quantity.
 */
export function materialLeftFromUsage(rows: readonly PlannedUsageRow[]): Cents | null {
  let any = false;
  let total = ZERO;
  for (const row of rows) {
    if (row.quantityPlanned === null || row.quantityPlanned === undefined || row.quantityPlanned === '') continue;
    any = true;
    if (row.suppliedBy === 'client') continue;
    const left = quantityToScaled(row.quantityPlanned) - quantityToScaled(row.quantityUsed) - quantityToScaled(row.quantityScrapped ?? 0);
    if (left > ZERO) total += divRound(left * priceToScaled(row.unitCost), TO_CENTS);
  }
  return any ? total : null;
}

/** Share of material cost that was scrap, in basis points. `null` with no material cost. */
export function scrapRateBp(scrapCents: Cents, materialCents: Cents): number | null {
  return ratioBp(scrapCents, materialCents);
}

/** Share of units that were scrapped, in basis points of good plus scrap. `null` with no units. */
export function scrapUnitsBp(unitsGood: Decimal, unitsScrap: Decimal): number | null {
  const scrap = quantityToScaled(unitsScrap);
  const all = quantityToScaled(unitsGood) + scrap;
  if (all <= ZERO) return null;
  return Number(divRound(scrap * BigInt(10000), all));
}
