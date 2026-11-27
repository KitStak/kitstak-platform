/**
 * Deal helpers (docs/programs/SPEC.md 3.11, A12, D10). One won rule for CRM and Projects, deal
 * values to cents, the monthly share of a deal, and the price card prefill from a deal. Pure.
 */
import { formatCents } from './format';
import { type Cents, type CentsLike, ZERO, divRound, toCents, toScaled } from './money';

/** The whole word "won", any case: a letter, digit or underscore next to it makes another word ("Wonderful"). */
const WON_WORD = /(^|[^A-Za-z0-9_])won(?![A-Za-z0-9_])/i;

/**
 * The shared won rule (A12), exactly as the spec states it, so CRM, Projects and Pulse agree on
 * every label (the Projects record-triggers SQL uses the same word test, `~* '\\mwon\\M'`).
 * The board's done flag decides first: `isDone` true is won, false is not. Only when the board
 * has no flag for the label (null or missing) is its name read: it is won when it has the whole
 * word "won", in any case and anywhere in the name ("Won", "Closed won", "Closed-Won",
 * "Closed Won - Pending Signature"). Nothing else in the name is read: "Not won", "Won?" and
 * "Won't renew" have the whole word too (an apostrophe ends a word, as in Postgres), so a board
 * with such a label marks it not done, the way E31 does for "Won back later".
 */
export function isWonStage(label: { readonly isDone?: boolean | null; readonly name?: string | null }): boolean {
  if (label.isDone === true) return true;
  if (label.isDone === false) return false;
  return WON_WORD.test(label.name ?? '');
}

/**
 * A deal value in whole currency units (a number, or a numeric string such as `"386,400"` or
 * `"$386,400.00"`) to cents, rounded half away from zero to the cent. A comma must group
 * thousands, and the first group cannot start with 0 (`1,23`, `1.234,56`, `1,2,3`, `12,34,567`,
 * and a European `0,500` or `00,123` are null, never a guess of $500 or $123). Null for anything
 * else. A plain `0500` with no comma is still 500.
 */
export function dealValueToCents(amount: unknown): Cents | null {
  if (typeof amount === 'bigint') return amount * BigInt(100);
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) return null;
    return toScaled(amount, 2);
  }
  if (typeof amount !== 'string') return null;
  // Grouping is checked before anything is stripped: a comma must group thousands (the same
  // NUMBER rule as variants.ts plainNumber), so a European `1,23` or `1.234,56` and a stray
  // `1,2,3` are refused instead of read 100 times too large or too small.
  const text = amount.trim();
  if (!DEAL_NUMBER.test(text)) return null;
  return toScaled(text.replace(/[$,\s]/g, ''), 2);
}

/** A deal value such as `386400`, `386,400`, `$386,400.00`, `-$1,000` or `.5`. Commas only group thousands, and a grouped number starts with 1 to 9. */
const DEAL_NUMBER = /^[+-]?\$?\s*([1-9]\d{0,2}(,\d{3})+|\d+)(\.\d+)?$|^[+-]?\$?\s*\.\d+$/;

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
