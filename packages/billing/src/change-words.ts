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
import {
  type BillingInterval,
  CATALOG,
  formatMoney,
  isBundle,
  type PlanSelection,
  PRODUCT_IDS,
  type ProductId,
  productListLabel,
  quantityFor,
  unitCents,
} from './catalog';
import type { ProrationDirection } from './proration';

/** The rule in one sentence. The pricing page and the Terms say the same words. */
export const STARTED_DAY_RULE = 'A day that has started counts as used.';

export interface ChangeWordsLine {
  readonly amountCents: number;
  readonly proration: boolean;
  /** The app the line is for. Missing or null when the gateway did not say. */
  readonly product?: ProductId | null;
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
  /**
   * The plan before and after the change (review round 3). With these the sentences can name the
   * real cause of an amount: which app came off, which was added, and whether the bundle discount
   * started or ended. Without them only the plain sentences are used.
   */
  readonly before?: PlanSelection;
  readonly after?: PlanSelection;
  /** What the plan costs each period now, and after the change. Used by the bundle sentence. */
  readonly beforeRecurringCents?: number;
  readonly afterRecurringCents?: number;
}

export interface ChangeWords {
  /** Goes under "Due today". */
  readonly dueTodayNote: string;
  /** Goes after "You get $X credit on your next bill." null when the change leaves no credit. */
  readonly creditNote: string | null;
  /**
   * Said before the person confirms, when the change starts or ends the bundle discount: "Removing
   * Pulse ends your 20% bundle discount. ..." null when the discount stays as it is.
   */
  readonly bundleNote: string | null;
  /** 'warning' when the discount ends, 'info' when it starts. null with no `bundleNote`. */
  readonly bundleNoteTone: 'warning' | 'info' | null;
}

const NOTHING = 'Nothing to pay now.';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function planName(interval: BillingInterval): string {
  return interval === 'yearly' ? 'yearly plan' : 'monthly plan';
}

/* ===== what changed between two plans ===== */

interface KeptApp {
  readonly product: ProductId;
  readonly name: string;
  readonly oldUnitCents: number;
  readonly newUnitCents: number;
  readonly sameQuantity: boolean;
}

interface PlanDiff {
  readonly removed: readonly ProductId[];
  readonly added: readonly ProductId[];
  readonly kept: readonly KeptApp[];
  readonly bundleEnds: boolean;
  readonly bundleStarts: boolean;
  /** The one app that stays and changes price because the bundle started or ended. null otherwise. */
  readonly repriced: KeptApp | null;
}

function planDiff(before: PlanSelection, after: PlanSelection): PlanDiff {
  const removed = PRODUCT_IDS.filter((id) => before.products.includes(id) && !after.products.includes(id));
  const added = PRODUCT_IDS.filter((id) => after.products.includes(id) && !before.products.includes(id));
  const bundleBefore = isBundle(before.products);
  const bundleAfter = isBundle(after.products);
  const kept = PRODUCT_IDS.filter((id) => before.products.includes(id) && after.products.includes(id)).map((product) => ({
    product,
    name: CATALOG.products[product].shortName,
    oldUnitCents: unitCents(product, before.interval, bundleBefore),
    newUnitCents: unitCents(product, after.interval, bundleAfter),
    sameQuantity: quantityFor(product, before) === quantityFor(product, after),
  }));
  const bundleEnds = bundleBefore && !bundleAfter;
  const bundleStarts = !bundleBefore && bundleAfter;
  const changed = kept.filter((app) => app.oldUnitCents !== app.newUnitCents);
  return {
    removed,
    added,
    kept,
    bundleEnds,
    bundleStarts,
    repriced: (bundleEnds || bundleStarts) && kept.length === 1 && changed.length === 1 ? changed[0]! : null,
  };
}

/** '$29 per user', '$279.20 per warehouse', '$23.20 per month' for a flat price. */
function unitPriceWords(product: ProductId, interval: BillingInterval, cents: number): string {
  const pricing = CATALOG.products[product];
  const each = pricing.quantityFrom === 'flat' ? (interval === 'yearly' ? 'per year' : 'per month') : `per ${pricing.unit}`;
  return `${formatMoney(cents, { trimZeroCents: true })} ${each}`;
}

/** 'from $23.20 to $29 per user'. */
function repriceWords(app: KeptApp, interval: BillingInterval): string {
  return `from ${formatMoney(app.oldUnitCents, { trimZeroCents: true })} to ${unitPriceWords(app.product, interval, app.newUnitCents)}`;
}

/**
 * The plain warning (or the good news) about the bundle discount, said before a person confirms a
 * change, and usable by the plan picker as soon as an app is switched on or off. null when the
 * discount stays as it is. PURE: it needs only the two plans.
 *
 *  - 'Removing Pulse ends your 20% bundle discount. Your CRM goes from $23.20 to $29 per user. Your
 *    plan goes from $185.60 to $203.00 per month. Keeping Pulse costs less.'
 *  - 'Adding Pulse starts your 20% bundle discount. Your CRM goes from $29 to $23.20 per user.'
 */
export function bundleChangeNote(input: {
  readonly before: PlanSelection;
  readonly after: PlanSelection;
  readonly beforeRecurringCents: number;
  readonly afterRecurringCents: number;
}): { readonly text: string; readonly tone: 'warning' | 'info' } | null {
  const { before, after } = input;
  if (before.interval !== after.interval) return null;
  const diff = planDiff(before, after);
  const percent = CATALOG.bundlePercentOff;
  const period = after.interval === 'yearly' ? 'per year' : 'per month';
  const totals = `Your plan goes from ${formatMoney(input.beforeRecurringCents)} to ${formatMoney(input.afterRecurringCents)} ${period}.`;

  if (diff.bundleEnds && diff.removed.length > 0) {
    const names = productListLabel(diff.removed);
    const parts = [`Removing ${names} ends your ${percent}% bundle discount.`];
    if (diff.repriced) parts.push(`Your ${diff.repriced.name} goes ${repriceWords(diff.repriced, after.interval)}.`);
    parts.push(totals);
    // The part nobody expects: taking an app off can raise the bill.
    if (input.afterRecurringCents > input.beforeRecurringCents) parts.push(`Keeping ${names} costs less.`);
    return { text: parts.join(' '), tone: 'warning' };
  }
  if (diff.bundleStarts && diff.added.length > 0) {
    const names = productListLabel(diff.added);
    const parts = [`Adding ${names} starts your ${percent}% bundle discount.`];
    if (diff.repriced) parts.push(`Your ${diff.repriced.name} goes ${repriceWords(diff.repriced, after.interval)}.`);
    if (input.afterRecurringCents < input.beforeRecurringCents) parts.push(totals);
    return { text: parts.join(' '), tone: 'info' };
  }
  return null;
}

/** The prorated amounts of a change, split by what happened to each app. null when a line names no app. */
function splitByApp(
  lines: readonly ChangeWordsLine[],
  diff: PlanDiff,
): { removedBack: number; addedPart: number; keptBack: number; keptPart: number } | null {
  const sums = { removedBack: 0, addedPart: 0, keptBack: 0, keptPart: 0 };
  for (const line of lines) {
    if (!line.proration || line.amountCents === 0) continue;
    const product = line.product ?? null;
    if (product === null) return null;
    if (diff.removed.includes(product)) {
      if (line.amountCents > 0) return null;
      sums.removedBack -= line.amountCents;
    } else if (diff.added.includes(product)) {
      if (line.amountCents < 0) return null;
      sums.addedPart += line.amountCents;
    } else if (line.amountCents < 0) sums.keptBack -= line.amountCents;
    else sums.keptPart += line.amountCents;
  }
  return sums;
}

function plainWords(input: ChangeWordsInput, diff: PlanDiff | null): Pick<ChangeWords, 'dueTodayNote' | 'creditNote'> {
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
      // "What you add" is only said when an app really was added and nothing else changed price
      // (review round 3). Otherwise the amount is the same days at the new prices.
      const onlyAdds = diff === null || (diff.added.length > 0 && diff.kept.every((app) => app.oldUnitCents === app.newUnitCents && app.sameQuantity));
      creditNote = onlyAdds
        ? `That is ${money(unused)} for ${fullDays} of what you take off, less ${money(part)} for what you add. ${STARTED_DAY_RULE}`
        : `That is ${money(unused)} for ${fullDays} at your old prices, less ${money(part)} for the same days at your new prices. ${STARTED_DAY_RULE}`;
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
    const extra = part > 0 ? ` Plus ${money(part)} for ${diff !== null && diff.added.length === 0 ? 'the change' : 'what you add'}.` : '';
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
  // "What you take off" is only said when an app really came off and nothing that stays changed price.
  const onlySwap = diff === null || (diff.removed.length > 0 && diff.kept.every((app) => app.oldUnitCents === app.newUnitCents && app.sameQuantity));
  const back = unused > 0 ? (onlySwap ? ` Less ${money(unused)} for what you take off.` : ` Less ${money(unused)} for the same days at your old prices.`) : '';
  const lead = onlySwap ? `${money(part)} for ${chargeDays}.` : `${money(part)} for ${chargeDays} at your new prices.`;
  return {
    dueTodayNote: `${lead}${back}${taxPart}${fromCredit(input.creditAppliedCents)}`,
    creditNote: null,
  };
}

/**
 * The sentences for one change. When the change starts or ends the bundle discount, the sentences
 * name it, because that is the real reason for the amount: an app that stays changes its price.
 * Every amount named still adds up to what is due today or to the credit; when it would not, the
 * plain sentences are used.
 */
export function changeWords(input: ChangeWordsInput): ChangeWords {
  const money = formatMoney;
  const diff = input.before && input.after ? planDiff(input.before, input.after) : null;
  const plain = plainWords(input, diff);
  const note =
    input.before && input.after && input.beforeRecurringCents !== undefined && input.afterRecurringCents !== undefined
      ? bundleChangeNote({
          before: input.before,
          after: input.after,
          beforeRecurringCents: input.beforeRecurringCents,
          afterRecurringCents: input.afterRecurringCents,
        })
      : null;
  const out = (words: Pick<ChangeWords, 'dueTodayNote' | 'creditNote'>): ChangeWords => ({
    ...words,
    bundleNote: note?.text ?? null,
    bundleNoteTone: note?.tone ?? null,
  });

  const app = diff?.repriced ?? null;
  const days = input.daysLeft;
  // The bundle sentences are for the plain case: same billing period, one app that stays with the
  // same count, and prorated lines that each name their app.
  if (!diff || !app || !app.sameQuantity || !input.after || days === null || input.fromInterval !== input.toInterval) return out(plain);
  const split = splitByApp(input.lines, diff);
  if (!split) return out(plain);
  if (input.lines.some((line) => !line.proration && line.amountCents > 0)) return out(plain);

  const tax = Math.max(0, input.taxCents);
  const taxPart = tax > 0 ? ` Plus ${money(tax)} sales tax.` : '';
  const fromCredit = input.creditAppliedCents > 0 ? ` Less ${money(input.creditAppliedCents)} from your credit.` : '';
  const chargeDays = days > 0 ? `the ${plural(days, 'day', 'days')} left in this period` : 'the time left in this period';
  const fullDays = `the ${plural(days, 'full day', 'full days')} left`;
  const need = `the bundle discount needs ${CATALOG.bundleMinProducts} apps`;
  const price = repriceWords(app, input.after.interval);

  if (diff.bundleEnds && diff.added.length === 0 && diff.removed.length > 0) {
    const more = split.keptPart - split.keptBack;
    const back = split.removedBack;
    const names = productListLabel(diff.removed);
    if (more <= 0 || back <= 0) return out(plain);
    if (input.creditCents > 0 && back - more === input.creditCents) {
      return out({
        dueTodayNote: NOTHING,
        creditNote: `That is ${money(back)} back for ${names}, for ${fullDays}. Your ${app.name} goes ${price}, because ${need}. That takes ${money(more)} off the credit. ${STARTED_DAY_RULE}`,
      });
    }
    if (input.creditCents === 0 && more - back + tax - input.creditAppliedCents === input.dueTodayCents && more - back + tax > 0) {
      return out({
        dueTodayNote: `Your ${app.name} goes ${price}, because ${need}. For ${chargeDays} that is ${money(more)} more. Less ${money(back)} back for ${names}.${taxPart}${fromCredit}`,
        creditNote: null,
      });
    }
    return out(plain);
  }

  if (diff.bundleStarts && diff.removed.length === 0 && diff.added.length > 0) {
    const saved = split.keptBack - split.keptPart;
    const cost = split.addedPart;
    const names = productListLabel(diff.added);
    if (saved <= 0 || cost <= 0) return out(plain);
    if (input.creditCents > 0 && saved - cost === input.creditCents) {
      return out({
        dueTodayNote: NOTHING,
        creditNote: `Your ${app.name} goes ${price} with the bundle discount. That is ${money(saved)} back for ${fullDays}, less ${money(cost)} for ${names}. ${STARTED_DAY_RULE}`,
      });
    }
    if (input.creditCents === 0 && cost - saved + tax - input.creditAppliedCents === input.dueTodayCents && cost - saved + tax > 0) {
      return out({
        dueTodayNote: `${money(cost)} for ${names} for ${chargeDays}. Less ${money(saved)}, because your ${app.name} goes ${price} with the bundle discount.${taxPart}${fromCredit}`,
        creditNote: null,
      });
    }
  }
  return out(plain);
}
