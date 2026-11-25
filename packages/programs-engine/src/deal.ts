/**
 * Deal helpers (docs/programs/SPEC.md 3.11, A12, D10). One won rule for CRM and Projects, deal
 * values to cents, the monthly share of a deal, and the price card prefill from a deal. Pure.
 */
import { formatCents } from './format';
import { type Cents, type CentsLike, ZERO, divRound, toCents, toScaled } from './money';

/** Words that, right before "won", undo it ("Not won", "Never won", "No won deals"). Up to one word may sit between ("Not yet won"). */
const NEGATIONS = new Set(['not', 'never', 'no', 'nor', 'isnt', 'wasnt', 'werent', 'arent', 'didnt', 'hasnt', 'havent', 'hadnt', 'cant', 'cannot']);
/** The one word anywhere in a label that undoes "won" ("Lost to competitor who won"). A12 reads every other label with the whole word "won" as won. */
const LOST_WORD = 'lost';

/** The label's words, lower case. An apostrophe joins a word ("won't" is one word, "wont"), so it never reads as "won". */
function labelWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
}

/**
 * The shared won rule (A12). The board's done flag decides first: `isDone` true is won, false is
 * not. Only when the board has no flag for the label is its name read: it is won when it has the
 * whole word "won" and:
 * - no negation sits right before it, with at most one word between ("Not won", "Never won",
 *   "Not yet won" are not won);
 * - the label does not have the word "lost" ("Lost to competitor who won");
 * - it is not a question ("Won?").
 * Nothing else is read into the name, so "Closed Won - Pending Signature" and "Won (expected
 * start Jan)" are won, the way a CRM board that names its won stage that way means it. A board
 * that wants "Won back later" read as not won marks the label not done (E31). An apostrophe joins
 * a word, so "Won't buy" is not won. "Closed won", "Closed-Won", "Deal's won" and "Won (signed)"
 * are won.
 */
export function isWonStage(label: { readonly isDone?: boolean | null; readonly name?: string | null }): boolean {
  if (label.isDone === true) return true;
  if (label.isDone === false) return false;
  const name = label.name ?? '';
  if (name.includes('?')) return false;
  const words = labelWords(name);
  let won = false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as string;
    if (word === LOST_WORD) return false;
    if (word !== 'won') continue;
    const before = words.slice(Math.max(0, index - 2), index);
    if (before.some((prior) => NEGATIONS.has(prior))) return false;
    won = true;
  }
  return won;
}

/**
 * A deal value in whole currency units (a number, or a numeric string such as `"386,400"` or
 * `"$386,400.00"`) to cents, rounded half away from zero to the cent. Null for anything else.
 */
export function dealValueToCents(amount: unknown): Cents | null {
  if (typeof amount === 'bigint') return amount * BigInt(100);
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) return null;
    return toScaled(amount, 2);
  }
  if (typeof amount !== 'string') return null;
  const text = amount.trim().replace(/[$,\s]/g, '');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text)) return null;
  return toScaled(text, 2);
}

/** The monthly share of a deal: value over the term in months (12 when not set), rounded once. Null for a term under 1. */
export function monthlyFromDeal(input: { readonly valueCents: Cents; readonly termMonths: number | null }): Cents | null {
  const term = input.termMonths ?? 12;
  if (!Number.isInteger(term) || term < 1) return null;
  return divRound(input.valueCents, BigInt(term));
}

/** Rate columns a deal can carry (`@kitstak/db/crm-deal-facts`). Cents are whole cents. */
export interface DealRates {
  /** Dollars, up to 4 decimals. */
  readonly unitPrice?: string | null;
  readonly monthlyFeeCents?: CentsLike | null;
  readonly setupFeeCents?: CentsLike | null;
  readonly monthlyMinimumCents?: CentsLike | null;
  readonly termMonths?: number | null;
}

function sameCurrency(a: string | null, b: string): boolean {
  if (a === null || a.trim() === '') return true;
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

/**
 * The rates a deal fills in on a new price card. Only when the deal is in the program currency
 * (a deal with no currency counts as the program currency); else no rates and the note
 * "This deal is in EUR. Type the rates in USD."
 */
export function dealPrefill(input: { readonly deal: { readonly currency: string | null; readonly valueCents: Cents | null; readonly rates: DealRates }; readonly programCurrency: string }): { rates: DealRates | null; currencyNote: string | null } {
  if (!sameCurrency(input.deal.currency, input.programCurrency)) {
    return { rates: null, currencyNote: `This deal is in ${(input.deal.currency as string).trim().toUpperCase()}. Type the rates in ${input.programCurrency.trim().toUpperCase()}.` };
  }
  return { rates: input.deal.rates, currencyNote: null };
}

/**
 * The deal callout of the price card step: "From the deal: $386,400 over 12 months is about
 * $32,200 a month." Null when the deal has no value above 0.
 */
export function dealCallout(input: { readonly valueCents: Cents | null; readonly termMonths: number | null }): { text: string; monthlyCents: Cents } | null {
  if (input.valueCents === null || toCents(input.valueCents) <= ZERO) return null;
  const monthlyCents = monthlyFromDeal({ valueCents: input.valueCents, termMonths: input.termMonths });
  if (monthlyCents === null) return null;
  const term = input.termMonths ?? 12;
  return { text: `From the deal: ${formatCents(input.valueCents)} over ${term} ${term === 1 ? 'month' : 'months'} is about ${formatCents(monthlyCents)} a month.`, monthlyCents };
}
