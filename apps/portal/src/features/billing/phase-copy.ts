/**
 * What billing home says in each phase (SPEC 6.1, the table "What the Plan card and the main button
 * say"). PURE, so the words are unit tested and the page only lays them out.
 */
import { formatDay, formatDayShort, formatMoney } from '@kitstak/billing/catalog';
import { nextChargeLine, planEndedLine, type PlanPhase, type PlanState } from '@kitstak/billing/plan-state';
import { cardLabel, plural } from './format';

export type HomeActionId =
  | 'start_trial'
  | 'add_card'
  | 'change_apps'
  | 'change_plan'
  | 'update_card'
  | 'pay_now'
  | 'cancel'
  | 'keep_plan'
  | 'undo_pause'
  | 'resume_now'
  | 'pick_plan';

export interface HomeAction {
  readonly id: HomeActionId;
  readonly label: string;
}

export interface PhaseCopy {
  readonly badge: { readonly label: string; readonly tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' };
  /** The line on the Plan card. */
  readonly line: string;
  readonly primary: HomeAction;
  readonly others: readonly HomeAction[];
}

const ACTION: Readonly<Record<HomeActionId, string>> = {
  start_trial: 'Start free trial',
  add_card: 'Add a card',
  change_apps: 'Change trial apps',
  change_plan: 'Change plan',
  update_card: 'Update card',
  pay_now: 'Pay now',
  cancel: 'Cancel plan',
  keep_plan: 'Keep my plan',
  undo_pause: 'Undo pause',
  resume_now: 'Start again now',
  pick_plan: 'Pick a plan',
};

function action(id: HomeActionId): HomeAction {
  return { id, label: ACTION[id] };
}

const BADGE: Readonly<Record<PlanPhase, PhaseCopy['badge']>> = {
  none: { label: 'No plan', tone: 'neutral' },
  trial: { label: 'Free trial', tone: 'info' },
  trial_ended: { label: 'Trial ended', tone: 'danger' },
  active: { label: 'Active', tone: 'success' },
  past_due: { label: 'Payment due', tone: 'warning' },
  unpaid: { label: 'View only', tone: 'danger' },
  cancel_scheduled: { label: 'Ending', tone: 'warning' },
  pause_scheduled: { label: 'Pause planned', tone: 'info' },
  paused: { label: 'Paused', tone: 'warning' },
  ended: { label: 'Ended', tone: 'danger' },
};

export interface PhaseCopyOptions {
  /**
   * True when every app is open whatever the plan says (`ENTITLEMENTS_DEV_ALLOW_ALL`, on in
   * production until the last go live step). The words then never say "view only": that would not
   * be true, and a customer would read a wrong state (review round 4).
   */
  readonly appsOpen?: boolean;
}

/**
 * The Plan card line, the main button and the other actions for a plan state.
 *
 * A cancel that is set shows in every phase (review round 3): a plan that is late or paused and is
 * also set to end says so, offers "Keep my plan", and never offers "Cancel plan" a second time.
 */
export function phaseCopy(state: PlanState, timeZone: string, options: PhaseCopyOptions = {}): PhaseCopy {
  const copy = basePhaseCopy(state, timeZone, options.appsOpen === true);
  if (!state.cancelAt || state.phase === 'cancel_scheduled') return copy;
  const others = copy.others.filter((entry) => entry.id !== 'cancel' && entry.id !== 'keep_plan');
  return {
    ...copy,
    line: `${copy.line} It is set to end on ${formatDay(state.cancelAt, timeZone)}.`,
    others: copy.primary.id === 'keep_plan' ? others : [...others, action('keep_plan')],
  };
}

function basePhaseCopy(state: PlanState, timeZone: string, appsOpen: boolean): PhaseCopy {
  // "Your apps are view only." is only said when it is true.
  const viewOnly = appsOpen ? '' : ' Your apps are view only.';
  const day = (date: Date) => formatDay(date, timeZone);
  const short = (date: Date) => formatDayShort(date, timeZone);

  switch (state.phase) {
    case 'none':
      return state.trialEligible
        ? {
            badge: BADGE.none,
            line: 'You have no plan yet. Try any app free for 14 days.',
            primary: action('start_trial'),
            others: [],
          }
        : { badge: BADGE.none, line: 'You have no plan yet. Pick the apps you need.', primary: action('pick_plan'), others: [] };
    case 'trial': {
      const trial = state.trial;
      const left = trial ? `${plural(trial.daysLeft, 'day', 'days')} left. Ends ${day(trial.endsAt)}.` : '';
      return {
        badge: BADGE.trial,
        line: `Free trial. ${left}`.trim(),
        // One name for the paying step everywhere: the banner, the emails, the setup guide and this
        // button all say "Pick a plan" and all open the plan picker.
        primary: action('pick_plan'),
        others: [action('change_apps')],
      };
    }
    case 'trial_ended': {
      const ended = state.trial ? ` on ${day(state.trial.endsAt)}` : '';
      return {
        badge: BADGE.trial_ended,
        line: `Your free trial ended${ended}.${viewOnly} Your data is safe.`,
        primary: action('pick_plan'),
        others: [],
      };
    }
    case 'active': {
      if (state.trial) {
        return {
          badge: { label: 'Free trial', tone: 'info' },
          line: `Free trial. Your first payment is on ${day(state.nextCharge?.at ?? state.trial.endsAt)}.`,
          primary: action('change_plan'),
          others: [action('update_card'), action('cancel')],
        };
      }
      return {
        badge: BADGE.active,
        line: 'Your plan is active.',
        primary: action('change_plan'),
        others: [action('update_card'), action('cancel')],
      };
    }
    case 'past_due': {
      const due = state.pastDue;
      const parts = [
        due
          ? `We could not charge your ${cardLabel(state.paymentMethod)} for ${formatMoney(due.amountDueCents)}.`
          : 'We could not charge your card.',
      ];
      if (due?.nextRetryAt) parts.push(`We will try again on ${short(due.nextRetryAt)}.`);
      // Cancel is offered here too, and the cancel page says what it does while a bill is open: the
      // plan ends today and the bill is dropped.
      return { badge: BADGE.past_due, line: parts.join(' '), primary: action('update_card'), others: [action('pay_now'), action('cancel')] };
    }
    case 'unpaid':
      return {
        badge: appsOpen ? { label: 'Payment late', tone: 'danger' } : BADGE.unpaid,
        line: appsOpen ? 'Your payment is late.' : 'Your payment is late, so your apps are view only.',
        primary: action('update_card'),
        others: [action('pay_now'), action('cancel')],
      };
    case 'cancel_scheduled':
      return {
        badge: BADGE.cancel_scheduled,
        line: state.cancelAt
          ? `Your plan ends on ${day(state.cancelAt)}. You keep everything until then.`
          : 'Your plan is set to end. You keep everything until then.',
        primary: action('keep_plan'),
        others: [],
      };
    case 'pause_scheduled':
      return {
        badge: BADGE.pause_scheduled,
        line: state.pause
          ? `Your plan pauses on ${day(state.pause.startsAt)} and starts again on ${day(state.pause.resumesAt)}.`
          : 'Your plan is set to pause.',
        primary: action('undo_pause'),
        others: [],
      };
    case 'paused':
      return {
        badge: BADGE.paused,
        line: state.pause ? `Your plan is paused. It starts again on ${day(state.pause.resumesAt)}.` : 'Your plan is paused.',
        primary: action('resume_now'),
        others: [action('cancel')],
      };
    case 'ended': {
      // Says why it ended, so a customer who never canceled is told (review round 3): "We could not
      // collect $164.00 after 4 tries, so your plan ended on Nov 23, 2026."
      const ended = planEndedLine(state, timeZone) ?? 'Your plan ended.';
      return {
        badge: BADGE.ended,
        line: `${ended}${viewOnly} Your data is safe.`,
        primary: action('pick_plan'),
        others: [],
      };
    }
  }
}

/** The one sentence a member without billing rights sees (SPEC 6.1). No amounts. */
export function memberLine(state: PlanState, orgName: string, timeZone: string, options: PhaseCopyOptions = {}): string {
  const day = (date: Date) => formatDay(date, timeZone);
  const viewOnly = options.appsOpen === true ? '' : ' Your apps are view only.';
  switch (state.phase) {
    case 'none':
      return `${orgName} has no plan yet.`;
    case 'trial':
      return state.trial ? `${orgName} is on a free trial that ends ${day(state.trial.endsAt)}.` : `${orgName} is on a free trial.`;
    case 'trial_ended':
      return `The free trial for ${orgName} has ended.${viewOnly} Your data is safe.`;
    case 'active':
      return state.trial ? `${orgName} is on a free trial with a plan ready to start.` : `${orgName} has an active plan.`;
    case 'past_due':
      return `${orgName} has a payment due. Your apps still work.`;
    case 'unpaid':
      return options.appsOpen === true ? `A payment for ${orgName} is late.` : `A payment for ${orgName} is late, so your apps are view only.`;
    case 'cancel_scheduled':
      return state.cancelAt ? `The plan for ${orgName} ends on ${day(state.cancelAt)}.` : `The plan for ${orgName} is set to end.`;
    case 'pause_scheduled':
      return state.pause ? `The plan for ${orgName} pauses on ${day(state.pause.startsAt)}.` : `The plan for ${orgName} is set to pause.`;
    case 'paused':
      return state.pause
        ? `The plan for ${orgName} is paused until ${day(state.pause.resumesAt)}.${viewOnly}`
        : `The plan for ${orgName} is paused.${viewOnly}`;
    case 'ended':
      return `The plan for ${orgName} has ended.${viewOnly} Your data is safe.`;
  }
}

/** The Next charge card: a headline and one supporting line. */
export function nextChargeCopy(state: PlanState, timeZone: string, options: PhaseCopyOptions = {}): { readonly headline: string; readonly detail: string } {
  const payNow = options.appsOpen === true ? 'Pay now to keep your apps open.' : 'Pay now to turn your apps back on.';
  const day = (date: Date) => formatDay(date, timeZone);
  const short = (date: Date) => formatDayShort(date, timeZone);
  switch (state.phase) {
    case 'trial':
      return {
        headline: 'No charge planned',
        detail: state.trial ? `Pick a plan to keep your apps after ${short(state.trial.endsAt)}.` : 'Pick a plan to keep your apps.',
      };
    case 'active':
      // `nextChargeLine` names what the card will really be charged: the price, less a promo code,
      // less credit. The same sentence in every place that states the next charge.
      return state.nextCharge
        ? { headline: day(state.nextCharge.at), detail: nextChargeLine(state) ?? `${formatMoney(state.nextCharge.amountCents)} to your ${cardLabel(state.paymentMethod)}.` }
        : { headline: 'No charge planned', detail: 'Your plan has no charge coming up.' };
    case 'past_due':
      return {
        headline: state.pastDue?.nextRetryAt ? day(state.pastDue.nextRetryAt) : 'Payment due now',
        detail: state.pastDue
          ? `We will try ${formatMoney(state.pastDue.amountDueCents)} again. Your apps stay open until ${short(state.pastDue.accessChangesAt)}.`
          : 'Update your card to keep full access.',
      };
    case 'unpaid':
      return {
        headline: 'Payment due now',
        detail: state.pastDue ? `${formatMoney(state.pastDue.amountDueCents)} is late. ${payNow}` : payNow,
      };
    case 'cancel_scheduled':
      return { headline: 'No more charges', detail: state.cancelAt ? `Your plan ends on ${day(state.cancelAt)}.` : 'Your plan is set to end.' };
    case 'pause_scheduled':
    case 'paused':
      return state.pause
        ? { headline: day(state.pause.resumesAt), detail: `No bills while paused. Then ${formatMoney(state.quote.totalCents)}.` }
        : { headline: 'No charge planned', detail: 'No bills while paused.' };
    case 'none':
    case 'trial_ended':
    case 'ended':
      return { headline: 'No charge planned', detail: 'Nothing is charged until you pick a plan.' };
  }
}
