/**
 * The cart a person brings from the marketing site (docs/billing/SPEC.md sections 4.3 and 5). PURE.
 *
 * The link holds apps, seats, warehouses, the period and a few answers. It never holds a price or a
 * name. Every value is read through `parseHandoff`, which checks it against the catalog limits and
 * drops what it does not know, so a changed link can only build a cart a person could build by hand.
 */
import { encodeHandoff, parseHandoff, type SignupHandoff } from '@kitstak/billing/handoff';
import { quote, type Quote } from '@kitstak/billing/quote';
import { formatMoney, type ProductId } from '@kitstak/billing/catalog';

export type SearchParamRecord = Readonly<Record<string, string | string[] | undefined>>;

/** The handoff keys, and nothing else, as a plain record a server action can take. */
export function handoffRecord(handoff: SignupHandoff): Record<string, string> {
  const record: Record<string, string> = {};
  if (!hasHandoff(handoff)) return record;
  for (const [key, value] of encodeHandoff(handoff)) record[key] = value;
  return record;
}

/** True when the link carried something worth keeping: a cart or an answer. */
export function hasHandoff(handoff: SignupHandoff): boolean {
  return handoff.selection !== null || Object.keys(handoff.profile).length > 0 || handoff.source !== 'direct';
}

/** The cleaned query string (no leading "?"), or "" when the link carried nothing. */
export function handoffQuery(handoff: SignupHandoff): string {
  return hasHandoff(handoff) ? encodeHandoff(handoff).toString() : '';
}

/** `path` with the cart kept in the link, for moves between sign up and sign in. */
export function withHandoff(path: string, handoff: SignupHandoff, extra?: Readonly<Record<string, string | null>>): string {
  const params = new URLSearchParams(handoffQuery(handoff));
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export interface TrialSummary {
  readonly products: readonly ProductId[];
  readonly quote: Quote;
  /** "Then $395.20 per month if you add a card." */
  readonly thenLine: string;
  /** Set for yearly carts: "That is $335.92 per month." */
  readonly monthlyLine: string | null;
}

/** What the "Your free trial" card shows. null when the link carried no app. */
export function trialSummary(handoff: SignupHandoff): TrialSummary | null {
  if (!handoff.selection || handoff.selection.products.length === 0) return null;
  const priced = quote(handoff.selection);
  const period = priced.interval === 'yearly' ? 'year' : 'month';
  return {
    products: priced.selection.products,
    quote: priced,
    thenLine: `Then ${formatMoney(priced.totalCents)} per ${period} if you add a card.`,
    monthlyLine: priced.interval === 'yearly' ? `That is ${formatMoney(priced.monthlyEquivalentCents)} per month.` : null,
  };
}

/** Reads the link the same way on the server (a record) and in the browser (URLSearchParams). */
export function readHandoff(params: URLSearchParams | SearchParamRecord): SignupHandoff {
  return parseHandoff(params);
}
