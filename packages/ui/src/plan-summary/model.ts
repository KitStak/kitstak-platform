/**
 * The words on the "Plan and payment" row that each app shows in its settings (docs/billing/SPEC.md
 * section 9.5, CONTRACTS section 18 rule 5). PURE: the plan facts come in, plain sentences come out,
 * so CRM, WMS, Projects and Pulse say the same thing with the same numbers.
 *
 * This package does not import `@kitstak/billing`. The input repeats the parts of `PlanState` it
 * reads (an app passes its `PlanState` straight in), and the two formatters are passed in so every
 * amount and date is still written by `formatMoney` and `formatDay` from the billing catalog.
 */
import type { AppSwitcherPlanBadge } from '../app-switcher/labels';

export type PlanSummaryApp = 'crm' | 'wms' | 'projects' | 'pulse';

export type PlanSummaryPhase =
  | 'none'
  | 'trial'
  | 'trial_ended'
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'cancel_scheduled'
  | 'pause_scheduled'
  | 'paused'
  | 'ended';

/** The parts of `PlanState` the row reads. `PlanState` is assignable to this. */
export interface PlanSummaryState {
  readonly phase: PlanSummaryPhase;
  /** The apps in the plan (or the trial). Only the list of app ids is read. */
  readonly selection: { readonly products: readonly string[] };
  readonly trial: { readonly endsAt: Date; readonly daysLeft: number } | null;
  readonly trialEligible: boolean;
  readonly nextCharge: { readonly amountCents: number; readonly at: Date } | null;
  readonly pastDue: { readonly amountDueCents: number; readonly accessChangesAt: Date } | null;
  readonly cancelAt: Date | null;
  readonly pause: { readonly startsAt: Date; readonly resumesAt: Date } | null;
  readonly endedAt: Date | null;
  readonly usage: {
    readonly seatsUsed: number;
    readonly seatsPaid: number | null;
    readonly seatLimit: number | null;
    readonly warehousesUsed: number | null;
    readonly warehousesPaid: number | null;
  };
}

export interface PlanSummaryInput {
  readonly app: PlanSummaryApp;
  readonly state: PlanSummaryState;
  /** This app's badge, from `planBadgeFor` or `AppPlanView.badges`. */
  readonly badge: AppSwitcherPlanBadge;
  /**
   * True when every app is open without a plan (the `ENTITLEMENTS_DEV_ALLOW_ALL` switch is on and
   * the organization has no trial and no plan). The row then says so, instead of "no plan yet".
   */
  readonly openAccess?: boolean;
  /** Owner, admin or billing manager: sees the money line and the link. */
  readonly canView: boolean;
  /** Who a member should ask. */
  readonly ownerName: string | null;
  /** `billingLink(portalUrl, { to: 'home' }, app)`. */
  readonly billingHref: string;
  /** Seats the flat Pulse price covers (`CATALOG.products.pulse.includedSeats`). */
  readonly pulseIncludedSeats: number;
  /** "Talk to us" on the marketing site, for a team that needs more Pulse seats. */
  readonly contactHref: string;
  readonly format: {
    /** `formatMoney` from the billing catalog. */
    readonly money: (cents: number) => string;
    /** `formatDay` from the billing catalog, with the viewer's time zone already applied. */
    readonly day: (date: Date) => string;
  };
}

export interface PlanSummaryLink {
  readonly label: string;
  readonly href: string;
}

export interface PlanSummaryView {
  readonly badge: AppSwitcherPlanBadge;
  /** The next charge line, or who to ask. Always one or two short sentences. */
  readonly line: string;
  /** Seats or warehouses in use, and the Pulse seat note. */
  readonly facts: readonly string[];
  /** Link to billing home. null for people who cannot see billing. */
  readonly action: PlanSummaryLink | null;
  /** A second, quieter link ("Talk to us" for more Pulse seats). */
  readonly extra: PlanSummaryLink | null;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function chargeLine(input: PlanSummaryInput): string {
  const { state, format } = input;
  switch (state.phase) {
    case 'none':
      if (input.openAccess) return 'Every app is included for your organization right now. Nothing is charged.';
      return state.trialEligible
        ? 'You have no plan yet. Start a free trial in the Portal.'
        : 'You have no plan yet. Pick one in the Portal.';
    case 'trial':
      if (!state.trial) return 'You are on a free trial.';
      if (state.trial.daysLeft <= 0) return 'Your free trial ends today. No card on file yet.';
      return `Free trial. ${count(state.trial.daysLeft, 'day', 'days')} left. It ends on ${format.day(state.trial.endsAt)}.`;
    case 'trial_ended':
      return state.trial
        ? `Your free trial ended on ${format.day(state.trial.endsAt)}. Pick a plan to keep working.`
        : 'Your free trial ended. Pick a plan to keep working.';
    case 'active':
      if (!state.nextCharge) return 'Your plan is active. No charge is planned.';
      return state.trial
        ? `Free trial. Your first payment of ${format.money(state.nextCharge.amountCents)} is on ${format.day(state.nextCharge.at)}.`
        : `Your next payment of ${format.money(state.nextCharge.amountCents)} is on ${format.day(state.nextCharge.at)}.`;
    case 'past_due':
      return state.pastDue
        ? `A payment of ${format.money(state.pastDue.amountDueCents)} failed. Update your card by ${format.day(state.pastDue.accessChangesAt)} to keep full access.`
        : 'A payment failed. Update your card to keep full access.';
    case 'unpaid':
      return 'Your payment is late, so your apps are view only. Update your card to turn them back on.';
    case 'cancel_scheduled':
      return state.cancelAt
        ? `Your plan ends on ${format.day(state.cancelAt)}. You keep everything until then.`
        : 'Your plan is set to end. You keep everything until then.';
    case 'pause_scheduled':
      return state.pause
        ? `Your plan pauses on ${format.day(state.pause.startsAt)} and starts again on ${format.day(state.pause.resumesAt)}.`
        : 'Your plan is set to pause.';
    case 'paused':
      return state.pause
        ? `Your plan is paused. It starts again on ${format.day(state.pause.resumesAt)}.`
        : 'Your plan is paused.';
    case 'ended':
      return state.endedAt
        ? `Your plan ended on ${format.day(state.endedAt)}. Your data is safe.`
        : 'Your plan has ended. Your data is safe.';
  }
}

/**
 * In the WMS the word "billing" already means 3PL client billing, so that app says "plan"
 * (docs/billing/CONTRACTS.md section 1, rule 10).
 */
function openLabel(app: PlanSummaryApp): string {
  return app === 'wms' ? 'Manage plan' : 'Open billing';
}

function actionLabel(app: PlanSummaryApp, phase: PlanSummaryPhase, openAccess: boolean): string {
  if (openAccess && phase === 'none') return openLabel(app);
  switch (phase) {
    case 'none':
    case 'trial_ended':
    case 'ended':
      return 'Pick a plan';
    case 'past_due':
    case 'unpaid':
      return 'Fix payment';
    default:
      return openLabel(app);
  }
}

function seatFact(usage: PlanSummaryState['usage']): string {
  if (usage.seatsPaid !== null) return `${usage.seatsUsed} of ${count(usage.seatsPaid, 'seat', 'seats')} in use.`;
  return `${count(usage.seatsUsed, 'seat', 'seats')} in use.`;
}

function facts(input: PlanSummaryInput): { facts: string[]; extra: PlanSummaryLink | null } {
  const { app, state, badge } = input;
  const usage = state.usage;
  // An app that is not in the plan has no seats or warehouses to report.
  if (badge === 'not_in_plan') return { facts: [], extra: null };
  const inTrial = state.phase === 'trial';

  if (app === 'wms') {
    if (usage.warehousesUsed === null) return { facts: [], extra: null };
    if (usage.warehousesPaid !== null) {
      return {
        facts: [`${usage.warehousesUsed} of ${count(usage.warehousesPaid, 'warehouse', 'warehouses')} in use.`],
        extra: null,
      };
    }
    const base = `${count(usage.warehousesUsed, 'warehouse', 'warehouses')} in use.`;
    return { facts: inTrial ? [base, 'No warehouse limit during your free trial.'] : [base], extra: null };
  }

  if (app === 'pulse') {
    const included = input.pulseIncludedSeats;
    const extra = { label: 'Talk to us', href: input.contactHref };
    if (inTrial) {
      return {
        facts: [`${count(usage.seatsUsed, 'seat', 'seats')} in use. No seat limit during your free trial.`, `Pulse is one flat price for up to ${included} seats.`],
        extra: usage.seatsUsed > included ? extra : null,
      };
    }
    // Pulse alone: the flat price sets the team size. With CRM or Projects the seats come from them.
    const perSeatApp = state.selection.products.some((id) => id === 'crm' || id === 'projects');
    const pulseSetsLimit = !perSeatApp && usage.seatLimit !== null;
    if (pulseSetsLimit) {
      return {
        facts: [`${usage.seatsUsed} of ${count(usage.seatLimit ?? included, 'seat', 'seats')} in use.`, `Pulse is one flat price for up to ${included} seats. For a bigger team, talk to us.`],
        extra,
      };
    }
    if (usage.seatsPaid !== null) {
      return {
        facts: [seatFact(usage), `Your seat count comes from your other apps. Pulse covers ${included} seats.`],
        extra: usage.seatsPaid > included ? extra : null,
      };
    }
    return { facts: [`Pulse is one flat price for up to ${included} seats.`], extra: null };
  }

  // CRM and Projects are priced per seat.
  const base = seatFact(usage);
  return { facts: inTrial ? [base, 'No seat limit during your free trial.'] : [base], extra: null };
}

/** The whole row for one app and one viewer. Same input, same words, in every app. */
export function planSummaryFor(input: PlanSummaryInput): PlanSummaryView {
  if (!input.canView) {
    const who = input.ownerName ?? 'your organization owner';
    return {
      badge: input.badge,
      line: `${who} manages the plan for your team. Ask them about ${input.app === 'wms' ? 'the plan' : 'billing'}.`,
      facts: [],
      action: null,
      extra: null,
    };
  }
  const usage = facts(input);
  return {
    badge: input.badge,
    line: chargeLine(input),
    facts: usage.facts,
    action: { label: actionLabel(input.app, input.state.phase, input.openAccess === true), href: input.billingHref },
    extra: usage.extra,
  };
}
