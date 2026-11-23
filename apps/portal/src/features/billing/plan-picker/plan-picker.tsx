'use client';
/**
 * The one plan picker (docs/billing/CONTRACTS.md section 16.5, SPEC 5.3 and 6.2). Signup renders it in
 * `trial` mode; the billing area renders it for trial changes, checkout and paid plan changes.
 *
 * The price on screen is `quote(selection)`, the same pure function the server and the gateway
 * mapping use, so the picker never does its own math and updates on every key with no page load.
 * The browser only ever sends the selection. The server prices it again.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RadioGroup } from 'radix-ui';
import { ArrowRight, Check, CircleAlert, ShieldCheck } from 'lucide-react';
import { AppIcon } from '@kitstak/ui/app-icon';
import {
  CATALOG,
  MAX_SEATS,
  MAX_WAREHOUSES,
  PRODUCT_IDS,
  formatDay,
  formatMoney,
  isBundle,
  percentLabel,
  toStack,
  toggleProduct,
  type PlanSelection,
  type ProductId,
} from '@kitstak/billing/catalog';
import type { BillingError } from '@kitstak/billing/errors';
import type { PlanState } from '@kitstak/billing/plan-state';
import { quote } from '@kitstak/billing/quote';
import type { ChangePreview } from '@kitstak/billing/server';
import { Badge, Button, Card, Switch, cn } from '@/components/ui';
import {
  changeTrialProductsAction,
  confirmPlanChangeAction,
  openCardUpdateAction,
  previewPlanChangeAction,
  saveCartAction,
  saveCartDraftAction,
  startTrialAction,
} from '@/server/billing-actions';
import { saveSignupSelectionAction } from '@/server/signup-actions';
import { cardLabel, describeChange, perPeriod, sameSelection, showsSeats, unitPriceWords, usesSeats, usesWarehouses, listPriceWords } from '../format';
import { clearPlanDraft, readPlanDraft, writePlanDraft } from './plan-draft';
import { QuoteSummary, SummaryRow } from '../quote-summary';
import { ChangeConfirm } from './change-confirm';
import { QuantityStepper } from './quantity-stepper';

export interface PlanPickerProps {
  /** trial: start a free trial. trial_change: add or remove apps in a trial. change: change a paid plan.
   *  checkout: pick the plan to pay for (after a trial, or with a card during it). */
  readonly mode: 'trial' | 'trial_change' | 'change' | 'checkout';
  readonly initialSelection: PlanSelection;
  /** null only in mode 'trial' for a brand new org. */
  readonly planState: PlanState | null;
  readonly focus?: 'seats' | 'warehouses' | 'interval' | ProductId;
  /** Where the person goes after the primary action succeeds. Default: mode specific. */
  readonly doneHref?: string;
  /** signup: wider, no page chrome, heading "Pick your apps". billing: inside the billing shell. */
  readonly layout: 'signup' | 'billing';
  readonly timeZone: string;
  /** False for a viewer who may change trial apps but may not pay (an admin). Hides "Add a card". Default true. */
  readonly canPay?: boolean;
}

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kitstak.com').replace(/\/+$/, '');
const BILLING_OFF = 'Billing is not available right now. Nothing will be charged. Please try again later.';
const DAY_MS = 24 * 60 * 60 * 1000;

const FAQ: readonly { q: string; a: string }[] = [
  {
    q: 'What happens when my trial ends?',
    a: 'Your apps become view only. Nothing is deleted. Pick a plan to keep working.',
  },
  { q: 'Can I change seats later?', a: 'Yes. Any time. You pay only for the days left.' },
  { q: 'Can I cancel?', a: 'Yes. Two clicks in Billing. You keep access until the end of the period.' },
];

export function PlanPicker({ mode, initialSelection, planState, focus, doneHref, layout, timeZone, canPay = true }: PlanPickerProps) {
  const router = useRouter();

  // Apps KitStak granted by hand are never billed, so they are never part of a selection.
  const included = useMemo(
    () => PRODUCT_IDS.filter((id) => planState?.modules[id].source === 'manual' && planState.modules[id].access === 'full'),
    [planState],
  );
  const seatsUsed = planState?.usage.seatsUsed ?? 1;
  // People plus open invites: an open invite holds a seat, so the plan cannot go below this.
  const seatMin = planState?.usage.seatFloor ?? seatsUsed;
  const openInvites = planState?.usage.pendingInvites ?? 0;
  const warehousesUsed = planState?.usage.warehousesUsed ?? 0;

  const [selection, setSelection] = useState<PlanSelection>(() => ({
    ...initialSelection,
    products: toStack(initialSelection.products.filter((id) => !included.includes(id))),
    seats: Math.min(Math.max(initialSelection.seats, seatMin, 1), MAX_SEATS),
    warehouses: Math.min(Math.max(initialSelection.warehouses, warehousesUsed, 1), MAX_WAREHOUSES),
  }));
  const [busy, setBusy] = useState<null | 'primary' | 'confirm' | 'card'>(null);
  const [error, setError] = useState<BillingError | null>(null);
  const [trialUsed, setTrialUsed] = useState(false);
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmError, setConfirmError] = useState<BillingError | null>(null);
  // The day a new trial would end. Read once, so typing never moves it.
  const [newTrialEnd] = useState(() => new Date(Date.now() + CATALOG.trialDays * DAY_MS));
  const [openedAt] = useState(() => Date.now());

  // A person who already used their free trial picks a plan to pay for instead.
  const activeMode = mode === 'trial' && (trialUsed || planState?.trialEligible === false) ? 'checkout' : mode;
  const q = useMemo(() => quote(selection), [selection]);
  const current = planState?.selection ?? null;
  const currentQuote = planState?.quote ?? null;
  const unchanged = activeMode === 'change' && current !== null && sameSelection(current, selection);
  // "Unchanged" means the same apps as the trial has now. The saved cart can differ from the trial
  // (a plan the person started to pick), so the trial is read from the plan, not from the cart.
  const trialProducts = useMemo(() => (planState ? PRODUCT_IDS.filter((id) => planState.modules[id].inPlan) : []), [planState]);
  const trialUnchanged =
    activeMode === 'trial_change' &&
    current !== null &&
    sameSelection({ ...current, products: trialProducts.length > 0 ? trialProducts : current.products }, selection);
  const billingOff = planState?.mode === 'unavailable' && (activeMode === 'checkout' || activeMode === 'change');
  const empty = selection.products.length === 0;
  const trialRunning = planState?.phase === 'trial' && planState.trial !== null;
  const trialEndsAt = activeMode === 'trial' ? newTrialEnd : (planState?.trial?.endsAt ?? null);
  const noChargeToday = activeMode === 'trial' || activeMode === 'trial_change' || (activeMode === 'checkout' && trialRunning);

  const seatFloor = usesSeats(selection) ? Math.max(1, seatMin) : 1;
  const warehouseFloor = Math.max(1, warehousesUsed);
  const pulseSeats = CATALOG.products.pulse.includedSeats ?? 0;
  const pulsePeople = Math.max(selection.seats, seatsUsed);
  const pulseOver = selection.products.includes('pulse') && pulsePeople > pulseSeats;

  /*
   * Nothing a person picks here is lost by a refresh or a closed tab (docs/billing/SPEC.md 5.6):
   *   - at signup, every change is saved to the signup intent on the server;
   *   - when picking a plan to pay for, every change is saved to the cart on the server (the same
   *     cart the review step reads), quietly, with no activity entry;
   *   - a change that needs a confirm step (trial apps, a paid plan) is kept in this browser until
   *     it is saved or confirmed, and only while the plan it started from is still the same.
   */
  const draftKind: 'intent' | 'cart' | 'local' | null =
    activeMode === 'trial' ? (layout === 'signup' ? 'intent' : null) : activeMode === 'checkout' ? (canPay ? 'cart' : null) : 'local';
  const draftKey = planState ? `${planState.orgId}:${activeMode}` : null;
  const draftBase = `${trialProducts.join(',')}|${current ? `${current.products.join(',')}:${current.seats}:${current.warehouses}:${current.interval}` : ''}`;
  const touched = useRef(false);

  // A local draft is read after the first paint (the browser's storage is not there on the server).
  // A link that names an app, a seat count or a field wins over an old draft.
  useEffect(() => {
    if (draftKind !== 'local' || draftKey === null || focus !== undefined) return;
    const draft = readPlanDraft(draftKey, draftBase);
    if (!draft) return;
    const frame = requestAnimationFrame(() => {
      if (touched.current) return;
      setSelection((now) => ({
        ...now,
        products: toStack(draft.products.filter((id) => !included.includes(id))),
        seats: Math.min(Math.max(draft.seats, seatMin, 1), MAX_SEATS),
        warehouses: Math.min(Math.max(draft.warehouses, warehousesUsed, 1), MAX_WAREHOUSES),
        interval: draft.interval,
      }));
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the picker that was opened
  }, []);

  useEffect(() => {
    if (!touched.current || draftKind === null) return;
    if (draftKind === 'local') {
      if (draftKey !== null) writePlanDraft(draftKey, draftBase, selection);
      return;
    }
    if (selection.products.length === 0) return;
    // Wait for a pause in the typing, then save. A failed save is retried by the next change, and
    // the button the person presses next saves the same selection again anyway.
    const timer = setTimeout(() => {
      const save = draftKind === 'intent' ? saveSignupSelectionAction({ selection }) : saveCartDraftAction({ selection });
      void save.catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saves follow the selection only
  }, [selection]);

  const update = (next: PlanSelection) => {
    touched.current = true;
    setSelection(next);
    setError(null);
  };
  const toggle = (id: ProductId) => {
    const products = toggleProduct(selection.products, id);
    const next = { ...selection, products };
    // Turning on the first per user app must not leave fewer seats than people.
    if (usesSeats(next) && next.seats < seatMin) next.seats = Math.min(seatMin, MAX_SEATS);
    update(next);
  };

  const fail = (failure: BillingError) => {
    if (failure.code === 'trial_used') setTrialUsed(true);
    setError(failure);
    setBusy(null);
  };

  const goCheckout = async (which: 'primary') => {
    setBusy(which);
    setError(null);
    const saved = await saveCartAction({ selection });
    if (!saved.ok) return fail(saved.error);
    router.push('/billing/checkout');
  };

  const onPrimary = async () => {
    if (empty || busy) return;
    if (activeMode === 'trial') {
      setBusy('primary');
      setError(null);
      const started = await startTrialAction({ selection });
      if (!started.ok) return fail(started.error);
      router.push(doneHref ?? started.data.redirectTo);
      return;
    }
    if (activeMode === 'trial_change') {
      setBusy('primary');
      setError(null);
      // Seats and the pay period live in the saved cart. Only an owner or a billing manager may save
      // it, so an admin who changes trial apps still succeeds: that answer is not an error here.
      const saved = await saveCartAction({ selection });
      if (!saved.ok && saved.error.code !== 'forbidden') return fail(saved.error);
      const changed = await changeTrialProductsAction({ products: selection.products });
      if (!changed.ok) return fail(changed.error);
      if (draftKey !== null) clearPlanDraft(draftKey);
      router.push(doneHref ?? '/billing?notice=apps_saved');
      return;
    }
    if (activeMode === 'checkout') return goCheckout('primary');
    // change: ask the gateway what it costs, then show the confirm panel.
    setBusy('primary');
    setError(null);
    setConfirmError(null);
    const result = await previewPlanChangeAction({ selection });
    if (!result.ok) return fail(result.error);
    setPreview(result.data);
    setConfirmOpen(true);
    setBusy(null);
  };

  const onConfirm = async () => {
    if (!preview || busy) return;
    setBusy('confirm');
    setConfirmError(null);
    const result = await confirmPlanChangeAction({
      selection,
      basis: preview.basis,
      expectedDueTodayCents: preview.dueTodayCents,
    });
    if (result.ok) {
      if (draftKey !== null) clearPlanDraft(draftKey);
      router.push(doneHref ?? '/billing?notice=plan_updated');
      return;
    }
    if (result.error.code === 'price_changed') {
      // Another change landed. Load the new amount and ask again. Nothing was charged.
      const fresh = await previewPlanChangeAction({ selection });
      if (fresh.ok) setPreview(fresh.data);
    }
    setConfirmError(result.error);
    setBusy(null);
  };

  const onUpdateCard = async () => {
    setBusy('card');
    const result = await openCardUpdateAction();
    if (result.ok) {
      window.location.assign(result.data.url);
      return;
    }
    setConfirmError(result.error);
    setBusy(null);
  };

  const primaryLabel =
    activeMode === 'trial'
      ? 'Start my free trial'
      : activeMode === 'trial_change'
        ? 'Save my apps'
        : activeMode === 'checkout'
          ? mode === 'trial' || layout === 'signup'
            ? 'Continue to payment'
            : 'Continue to review'
          : 'Review change';
  const primaryDisabled = empty || billingOff || unchanged || trialUnchanged;
  const primaryHint = empty
    ? 'Pick at least one app.'
    : billingOff
      ? BILLING_OFF
      : unchanged
        ? 'Change something to review it.'
        : trialUnchanged
          ? 'These are the apps in your trial now.'
          : null;

  const totalLabel =
    activeMode === 'trial' || activeMode === 'trial_change' || (activeMode === 'checkout' && trialRunning)
      ? 'After your trial'
      : activeMode === 'change'
        ? 'New total'
        : undefined;
  const trust = [
    noChargeToday ? 'No charge today.' : activeMode === 'change' ? 'You see the amount before you confirm.' : `You pay ${formatMoney(q.totalCents)} today.`,
    'Cancel any time in Billing.',
    'Your data stays yours.',
  ];
  const daysLeftInPeriod =
    planState?.currentPeriodEnd ? Math.max(0, Math.ceil((planState.currentPeriodEnd.getTime() - openedAt) / DAY_MS)) : null;

  return (
    <div data-testid="plan-picker" data-mode={activeMode} className={cn('w-full', layout === 'signup' && 'mx-auto max-w-[1000px]')}>
      {layout === 'signup' ? (
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">Pick your apps</h1>
          <p className="mt-1 text-md text-fg-secondary">
            {activeMode === 'trial' ? `Try them free for ${CATALOG.trialDays} days. No card needed.` : 'Pick the apps you need. You review everything before you pay.'}
          </p>
        </header>
      ) : null}

      <div className="grid gap-6 pb-36 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:pb-0">
        <div className="flex min-w-0 flex-col gap-6">
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-sm font-semibold text-fg">Apps</legend>
            {PRODUCT_IDS.map((id) => {
              const pricing = CATALOG.products[id];
              const isIncluded = included.includes(id);
              const on = selection.products.includes(id);
              // The price this app has in the plan if it is on: a second app turns on the bundle price.
              const bundleIfOn = isBundle(toStack([...selection.products, id]));
              const discounted = bundleIfOn || selection.interval === 'yearly';
              const switchId = `plan-app-${id}`;
              return (
                <label
                  key={id}
                  htmlFor={isIncluded ? undefined : switchId}
                  className={cn(
                    'group flex min-h-[76px] items-center gap-4 rounded-xl border bg-panel px-4 py-3.5 shadow-xs',
                    'transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)] motion-reduce:transition-none',
                    isIncluded
                      ? 'border-border-subtle'
                      : on
                        ? 'cursor-pointer border-primary bg-primary-subtle/40 shadow-sm'
                        : 'cursor-pointer border-border-default hover:border-border-strong',
                    focus === id && 'ring-2 ring-focus ring-offset-2 ring-offset-app',
                  )}
                >
                  <span className={cn('inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-sunken', !on && !isIncluded && 'opacity-70')}>
                    <AppIcon app={id} size={38} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold text-fg">{pricing.shortName}</span>
                      {isIncluded ? <Badge tone="success">Included</Badge> : null}
                    </span>
                    <span className="mt-0.5 block text-sm text-fg-secondary">{pricing.tagline}</span>
                    {isIncluded ? (
                      <span className="mt-1 block text-sm text-fg-muted">Free for your organization. It is never billed.</span>
                    ) : (
                      <span className="mt-1 block text-sm text-fg">
                        <span className="font-semibold">{listPriceWords(id)}</span>
                        {pricing.includedSeats !== null ? <span className="text-fg-muted">. Up to {pricing.includedSeats} seats.</span> : null}
                        {discounted ? (
                          // "Your price" is only said about an app that is switched on. An app that is
                          // off shows what it would cost, and says why it is lower.
                          <span className={cn('mt-0.5 block text-xs font-medium', on ? 'text-success-text' : 'text-fg-muted')}>
                            {on ? 'Your price' : bundleIfOn ? 'With the bundle discount' : 'Paying yearly'}: {unitPriceWords(id, selection.interval, bundleIfOn)}.
                          </span>
                        ) : null}
                      </span>
                    )}
                  </span>
                  {isIncluded ? (
                    <Check aria-hidden className="size-5 shrink-0 text-success-text" />
                  ) : (
                    <Switch
                      id={switchId}
                      data-testid={`plan-product-${id}`}
                      checked={on}
                      onCheckedChange={() => toggle(id)}
                      aria-label={`${pricing.shortName}, ${listPriceWords(id)}`}
                      autoFocus={focus === id}
                    />
                  )}
                </label>
              );
            })}
            {selection.products.length === 1 ? (
              <p className="flex items-center gap-2 rounded-lg bg-success-subtle px-3 py-2 text-sm font-medium text-success-text">
                <ShieldCheck aria-hidden className="size-4 shrink-0" />
                Add a second app and save {percentLabel(CATALOG.bundlePercentOff)} on both.
              </p>
            ) : null}
          </fieldset>

          {showsSeats(selection) || usesWarehouses(selection) ? (
            <Card className="flex flex-col gap-6 p-5 sm:flex-row sm:gap-10">
              {showsSeats(selection) ? (
                <QuantityStepper
                  label="People on your team"
                  unit="seat"
                  testId="plan-seats"
                  value={selection.seats}
                  min={seatFloor}
                  max={MAX_SEATS}
                  onChange={(seats) => update({ ...selection, seats })}
                  autoFocus={focus === 'seats'}
                  hint={
                    usesSeats(selection)
                      ? 'One seat for each person who signs in. Guests are free.'
                      : `Pulse covers up to ${pulseSeats} people for one price.`
                  }
                  floorHint={
                    seatFloor <= 1
                      ? null
                      : openInvites > 0
                        ? `You have ${seatsUsed} ${seatsUsed === 1 ? 'person' : 'people'} and ${openInvites} open ${openInvites === 1 ? 'invite' : 'invites'}. Each open invite holds a seat. Remove someone or cancel an invite to go lower.`
                        : `You have ${seatsUsed} people. Remove someone first to go lower.`
                  }
                />
              ) : null}
              {usesWarehouses(selection) ? (
                <QuantityStepper
                  label="Warehouses"
                  unit="warehouse"
                  testId="plan-warehouses"
                  value={selection.warehouses}
                  min={warehouseFloor}
                  max={MAX_WAREHOUSES}
                  onChange={(warehouses) => update({ ...selection, warehouses })}
                  autoFocus={focus === 'warehouses'}
                  hint="One for each building you run in the WMS."
                  floorHint={
                    warehouseFloor > 1 ? `You have ${warehousesUsed} warehouses. Remove one in the WMS first to go lower.` : null
                  }
                />
              ) : null}
            </Card>
          ) : null}

          {pulseOver ? (
            <p role="status" data-testid="plan-pulse-note" className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning-subtle px-3 py-2 text-sm font-medium text-warning-text">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                {usesSeats(selection)
                  ? // With a per user app in the plan, Pulse follows the team: every seat can open it.
                    `The Pulse price is made for teams of up to ${pulseSeats} people. You picked ${pulsePeople} seats. All ${pulsePeople} people can use Pulse, at the price shown here.`
                  : // Pulse alone stops at its included seats: the next person cannot be added.
                    `Pulse alone covers a team of up to ${pulseSeats} people, and you have ${pulsePeople}. Add CRM or Projects to cover everyone.`}{' '}
                For a bigger team,{' '}
                <a href={`${SITE_URL}/contact?topic=sales`} className="underline underline-offset-2">
                  talk to us
                </a>
                .
              </span>
            </p>
          ) : null}

          <div>
            <p id="plan-interval-label" className="mb-3 text-sm font-semibold text-fg">
              How often you pay
            </p>
            <RadioGroup.Root
              aria-labelledby="plan-interval-label"
              value={selection.interval}
              onValueChange={(value) => update({ ...selection, interval: value === 'yearly' ? 'yearly' : 'monthly' })}
              className="grid gap-3 sm:grid-cols-2"
            >
              {(['monthly', 'yearly'] as const).map((interval) => {
                const on = selection.interval === interval;
                return (
                  <RadioGroup.Item
                    key={interval}
                    value={interval}
                    data-testid={`plan-interval-${interval}`}
                    autoFocus={focus === 'interval' && on}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-xl border bg-panel px-4 py-3 text-left shadow-xs',
                      'transition-[border-color,background-color] duration-[var(--duration-fast)] motion-reduce:transition-none',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                      on ? 'border-primary bg-primary-subtle/40' : 'border-border-default hover:border-border-strong',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'inline-flex size-4.5 shrink-0 items-center justify-center rounded-full border-[1.5px]',
                        on ? 'border-primary' : 'border-border-strong',
                      )}
                    >
                      <span className={cn('size-2 rounded-full bg-primary', !on && 'opacity-0')} />
                    </span>
                    <span className="text-base font-semibold text-fg">
                      {interval === 'monthly' ? 'Pay monthly' : `Pay yearly, save ${percentLabel(CATALOG.yearlyPercentOff)}`}
                    </span>
                  </RadioGroup.Item>
                );
              })}
            </RadioGroup.Root>
          </div>
        </div>

        <aside className="lg:sticky lg:top-20">
          <Card as="div" className="p-5">
            <h2 className="text-base font-semibold text-fg">
              {activeMode === 'trial' ? 'Your free trial' : activeMode === 'change' ? 'Your new plan' : 'Your plan'}
            </h2>

            {activeMode === 'change' && currentQuote ? (
              <p className="mt-2 rounded-lg bg-sunken px-3 py-2 text-sm text-fg-secondary" aria-live="polite">
                Now: <span className="font-semibold text-fg tabular-nums">{formatMoney(currentQuote.totalCents)}</span> {perPeriod(currentQuote.interval)}.{' '}
                New: <span className="font-semibold text-fg tabular-nums">{formatMoney(q.totalCents)}</span> {perPeriod(q.interval)}.
              </p>
            ) : null}

            <div data-testid={layout === 'signup' ? undefined : 'plan-summary'} className="mt-4">
              <QuoteSummary quote={q} totalLabel={totalLabel} live>
                {!empty && activeMode !== 'change' ? (
                  <SummaryRow label="Due today">{formatMoney(noChargeToday ? 0 : q.totalCents)}</SummaryRow>
                ) : null}
              </QuoteSummary>
            </div>

            {!empty && noChargeToday && trialEndsAt ? (
              <p className="mt-3 text-sm text-fg-secondary" suppressHydrationWarning>
                Your free trial ends on <span className="font-semibold text-fg">{formatDay(trialEndsAt, timeZone)}</span>.
              </p>
            ) : null}
            {activeMode === 'checkout' && (mode === 'trial' || planState?.phase === 'none') ? (
              <p className="mt-3 text-sm text-fg-secondary">You already used your free trial. You can still pick a plan.</p>
            ) : null}
            {q.isBundle ? (
              <p className="mt-3 text-xs text-fg-muted">
                The bundle discount stays as long as you have {CATALOG.bundleMinProducts} or more apps.
              </p>
            ) : null}

            <div
              className={cn(
                // On phones the total and the button stay on screen. From 1024 px they sit in the card.
                'fixed inset-x-0 bottom-0 z-30 border-t border-border-default bg-panel px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-sticky',
                'lg:static lg:z-auto lg:mt-5 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none',
              )}
            >
              <p className="mb-2 flex items-baseline justify-between gap-3 text-sm lg:hidden" aria-hidden>
                <span className="text-fg-secondary">{totalLabel ?? 'Total'}</span>
                <span className="font-semibold text-fg tabular-nums">
                  {empty ? formatMoney(0) : `${formatMoney(q.totalCents)} ${perPeriod(q.interval)}`}
                </span>
              </p>
              {error ? (
                <p role="alert" data-testid="plan-error" className="mb-2 flex items-start gap-1.5 text-sm font-medium text-danger-text">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {error.message}{' '}
                    {error.code === 'email_unverified' ? (
                      <Link href="/verify-email?next=/billing/plan" className="underline underline-offset-2">
                        Enter code
                      </Link>
                    ) : null}
                  </span>
                </p>
              ) : null}
              <div className="flex flex-col gap-2">
                <Button
                  size="xl"
                  fullWidth
                  data-testid="plan-submit"
                  loading={busy === 'primary'}
                  disabled={primaryDisabled || (busy !== null && busy !== 'primary')}
                  aria-describedby={primaryHint ? 'plan-submit-hint' : undefined}
                  trailingIcon={activeMode === 'trial' || activeMode === 'trial_change' ? undefined : <ArrowRight aria-hidden />}
                  onClick={onPrimary}
                >
                  {primaryLabel}
                </Button>
              </div>
              {primaryHint ? (
                <p id="plan-submit-hint" className="mt-2 text-center text-xs text-fg-muted">
                  {primaryHint}
                </p>
              ) : null}
            </div>

            <ul className="mt-4 flex flex-col gap-1.5">
              {trust.map((line) => (
                <li key={line} className="flex items-center gap-2 text-sm text-fg-secondary">
                  <Check aria-hidden className="size-4 shrink-0 text-success-text" />
                  {line}
                </li>
              ))}
            </ul>
            {/* One filled button per screen. The other job of this picker is a quiet link. */}
            {activeMode === 'trial_change' && canPay && planState?.mode !== 'unavailable' ? (
              <p className="mt-4 border-t border-border-subtle pt-3 text-sm text-fg-secondary">
                Ready to pay?{' '}
                <Link href="/billing/plan" data-testid="plan-pick-plan" className="font-semibold text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg">
                  Pick a plan
                </Link>
              </p>
            ) : null}
            {activeMode === 'checkout' && trialRunning && layout === 'billing' ? (
              <p className="mt-4 border-t border-border-subtle pt-3 text-sm text-fg-secondary">
                Not ready to pay?{' '}
                <Link href="/billing/plan?apps=1" data-testid="plan-change-trial-apps" className="font-semibold text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg">
                  Change your trial apps
                </Link>
              </p>
            ) : null}
          </Card>

          {activeMode === 'trial' || activeMode === 'trial_change' ? (
            <div className="mt-4 flex flex-col gap-2">
              {FAQ.map((item) => (
                <details key={item.q} className="group rounded-lg border border-border-default bg-panel px-4 py-1 shadow-xs">
                  <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md text-sm font-semibold text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                    {item.q}
                    <span aria-hidden className="text-fg-muted transition-transform group-open:rotate-45 motion-reduce:transition-none">
                      +
                    </span>
                  </summary>
                  <p className="pb-3 text-sm text-fg-secondary">{item.a}</p>
                </details>
              ))}
            </div>
          ) : null}
        </aside>
      </div>

      <ChangeConfirm
        open={confirmOpen}
        title={current ? describeChange(current, selection) : 'Change your plan'}
        preview={preview}
        interval={selection.interval}
        daysLeftInPeriod={daysLeftInPeriod}
        timeZone={timeZone}
        cardLabel={planState?.paymentMethod ? cardLabel(planState.paymentMethod) : null}
        error={confirmError}
        confirming={busy === 'confirm'}
        updatingCard={busy === 'card'}
        onConfirm={onConfirm}
        onUpdateCard={onUpdateCard}
        onClose={() => {
          setConfirmOpen(false);
          setConfirmError(null);
        }}
        verifyHref="/verify-email?next=/billing/plan"
      />
    </div>
  );
}
