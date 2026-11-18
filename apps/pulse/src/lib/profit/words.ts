/**
 * Small helpers for the plain language sentences the cost model writes (risk reasons, variance
 * readings, projection notes). 8th grade words, short sentences, and never a long dash.
 */
import { type Cents, absBig, divRound } from '../money';
import { formatMoney, formatNumber, formatPercentBp } from '../format';

export interface SentenceOptions {
  /** `false` gives the variant with no money in it, for readers who cannot see money. Default `true`. */
  readonly seesMoney?: boolean;
  /** ISO 4217 code. Default `USD`. */
  readonly currency?: string;
  /** BCP 47 locale. Default `en-US`. */
  readonly locale?: string;
  /** The job's unit word, for example "kit". Default "unit". */
  readonly unitLabel?: string;
}

/** Money for a sentence: whole dollars from $10 up ("$1,840"), cents below that ("$3.12"). Always above zero. */
export function sentenceMoney(cents: Cents, options: SentenceOptions = {}): string {
  const abs = absBig(cents);
  const whole = abs >= BigInt(1000);
  const value = whole ? divRound(abs, BigInt(100)) * BigInt(100) : abs;
  return formatMoney(value, { currency: options.currency, locale: options.locale, cents: !whole });
}

/** Money with cents for per unit amounts: "$3.12". */
export function sentenceUnitMoney(cents: Cents, options: SentenceOptions = {}): string {
  return formatMoney(absBig(cents), { currency: options.currency, locale: options.locale });
}

/** A whole percent from basis points: 2236 is "22%". */
export function sentencePercent(bp: number, options: SentenceOptions = {}): string {
  return formatPercentBp(bp, { digits: 0, locale: options.locale });
}

/** A number for a sentence with at most `maxDigits` places and no trailing zeros: 42, 31.5. */
export function sentenceNumber(value: number, maxDigits = 0, options: SentenceOptions = {}): string {
  return formatNumber(value, { maxDigits, locale: options.locale });
}

/** "1 day", "3 days". */
export function countWord(count: number, singular: string, plural = `${singular}s`): string {
  return `${sentenceNumber(count, 2)} ${count === 1 ? singular : plural}`;
}
