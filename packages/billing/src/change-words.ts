/**
 * The sentences under "Due today" and "Credit" in the confirm panel of a plan change (review round
 * 2, docs/billing/CONTRACTS.md section 25). PURE.
 *
 * The server writes them from the same numbers it charges, so a screen can never give a reason that
 * does not fit the amount. Every sentence names its amounts, and the amounts in it add up to what is
 * due today or to the credit. If they ever would not (a gateway line this file does not know), a
 * plain sentence with no numbers is used instead of a wrong one.
 *
 * The day rule is said out loud, because it is why adding a seat and taking it off again do not show
 * the same number: a charge counts the day that has started, a credit counts only full days left
 * (`proration.ts`).
 */
import { type BillingInterval, formatMoney } from './catalog';
import type { ProrationDirection } from './proration';

/** The rule in one sentence. The pricing page and the Terms say the same words. */
export const STARTED_DAY_RULE = 'A day that has started counts as used.';

export interface ChangeWordsLine {
  readonly amountCents: number;
  readonly proration: boolean;
}

export interface ChangeWordsInput {
  readonly dueTodayCents: number;
  /** Credit the change leaves. */
  readonly creditCents: number;
  /** Credit the customer already had that pays for this change. */
  readonly creditAppliedCents: number;
  readonly taxCents: number;
  readonly lines: readonly ChangeWordsLine[];
  /** Whole days the prorated part is for: rounded up for a charge, down for a credit. null in a free trial. */
  readonly daysLeft: number | null;
  readonly direction: ProrationDirection;
  readonly fromInterval: BillingInterval;
  readonly toInterval: BillingInterval;
}

export interface ChangeWords {
  /** Goes under "Due today". */
  readonly dueTodayNote: string;
  /** Goes after "You get $X credit on your next bill." null when the change leaves no credit. */
  readonly creditNote: string | null;
}

const NOTHING = 'Nothing to pay now.';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function planName(interval: BillingInterval): string {
  return interval === 'yearly' ? 'yearly plan' : 'monthly plan';
}

export function changeWords(input: ChangeWordsInput): ChangeWords {
  const money = formatMoney;
  // What the lines say, in three sums. The line "credit you already had" is not a proration line and
  // is not counted here; it is `creditAppliedCents`.
  const unused = -input.lines.filter((line) => line.proration && line.amountCents < 0).reduce((sum, line) => sum + line.amountCents, 0);
  const part = input.lines.filter((line) => line.proration && line.amountCents > 0).reduce((sum, line) => sum + line.amountCents, 0);
  const full = input.lines.filter((line) => !line.proration && line.amountCents > 0).reduce((sum, line) => sum + line.amountCents, 0);
  const tax = Math.max(0, input.taxCents);
  const net = full + part - unused + tax;
  const days = input.daysLeft;
  const intervalChanged = input.fromInterval !== input.toInterval;
  const nextPeriod = input.toInterval === 'yearly' ? 'year' : 'month';

  const chargeDays = days !== null && days > 0 ? `the ${plural(days, 'day', 'days')} left in this period` : 'the time left in this period';
  const fullDays = days !== null ? `the ${plural(days, 'full day', 'full days')} left` : 'the time left';
  const taxPart = tax > 0 ? ` Plus ${money(tax)} sales tax.` : '';
  const fromCredit = (cents: number): string => (cents > 0 ? ` Less ${money(cents)} from your credit.` : '');

  /* ----- nothing moves ----- */
  if (input.dueTodayCents === 0 && input.creditCents === 0 && input.creditAppliedCents === 0) {
    // A decrease with less than one full day left gives no credit. Say why, so 0 is not a surprise.
    if (input.direction === 'credit' && days === 0 && !intervalChanged) {
      return { dueTodayNote: `${NOTHING} Less than one full day is left in this period, so there is no credit.`, creditNote: null };
    }
    return { dueTodayNote: NOTHING, creditNote: null };
  }

  /* ----- the change leaves credit ----- */
  if (input.creditCents > 0) {
    let creditNote: string;
    if (intervalChanged && unused - full - part === input.creditCents && full > 0) {
      creditNote = `That is ${money(unused)} for ${fullDays} on your ${planName(input.fromInterval)}, less ${money(full)} for the next ${nextPeriod}. ${STARTED_DAY_RULE}`;
    } else if (!intervalChanged && part > 0 && unused - part === input.creditCents) {
      creditNote = `That is ${money(unused)} for ${fullDays} of what you take off, less ${money(part)} for what you add. ${STARTED_DAY_RULE}`;
    } else if (unused === input.creditCents) {
      creditNote = `That is for ${fullDays} in this period. ${STARTED_DAY_RULE}`;
    } else {
      creditNote = `That is for the part of this period you did not use. ${STARTED_DAY_RULE}`;
    }
    return { dueTodayNote: NOTHING, creditNote };
  }

  /* ----- the change costs something: paid by card, by credit, or both ----- */
  const addsUp = net - input.creditAppliedCents === input.dueTodayCents && net > 0;
  if (!addsUp) {
    // Never a sentence whose numbers do not add up.
    return {
      dueTodayNote:
        input.creditAppliedCents > 0
          ? `This is the price of the change, less ${money(input.creditAppliedCents)} from your credit.`
          : 'This is the price of the change for the time left in this period.',
      creditNote: null,
    };
  }

  if (intervalChanged) {
    // A new period starts today and is paid in full. The unused part of the old one comes off.
    const back = unused > 0 ? ` Less ${money(unused)} for ${fullDays} on your ${planName(input.fromInterval)}.` : '';
    const extra = part > 0 ? ` Plus ${money(part)} for what you add.` : '';
    return {
      dueTodayNote: `${money(full)} for the next ${nextPeriod}.${extra}${back}${taxPart}${fromCredit(input.creditAppliedCents)}`,
      creditNote: null,
    };
  }

  if (unused === 0 && tax === 0) {
    // The plain case: something was added.
    if (input.creditAppliedCents === 0) return { dueTodayNote: `For ${chargeDays}.`, creditNote: null };
    return {
      dueTodayNote:
        input.dueTodayCents > 0
          ? `${money(part)} for ${chargeDays}, less ${money(input.creditAppliedCents)} paid from your credit.`
          : `${money(part)} for ${chargeDays}. Paid from your credit.`,
      creditNote: null,
    };
  }

  // Something was added and something was taken off in one change (an app swapped, a bundle price).
  const back = unused > 0 ? ` Less ${money(unused)} for what you take off.` : '';
  return {
    dueTodayNote: `${money(part)} for ${chargeDays}.${back}${taxPart}${fromCredit(input.creditAppliedCents)}`,
    creditNote: null,
  };
}
