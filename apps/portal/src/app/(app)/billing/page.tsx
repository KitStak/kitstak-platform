import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Info, ShieldQuestion } from 'lucide-react';
import { CATALOG, PRODUCT_IDS, isProductId, type ProductId } from '@kitstak/billing/catalog';
import { planBadgeFor, type PlanBadge, type PlanState } from '@kitstak/billing/plan-state';
import { getBillingProfile, getPlanState, listBillingHolders, listInvoices, retryPayment } from '@kitstak/billing/server';
import { isDevAllowAll } from '@kitstak/entitlements';
import { appReturnPath } from '@/lib/routes';
import { appsAskedToday } from '@/server/ask';
import { requireBillingContext } from '@/server/billing/context';
import { firstNameOf } from '@/features/signup/fields';
import { env, isProduction } from '@/server/env';
import { Badge, Card, Notice } from '@/components/ui';
import { BillingHeader, TestModeBadge } from '@/features/billing/billing-chrome';
import { RememberAppReturn } from '@/features/billing/home/app-return';
import { Flash, type FlashBackTargets, type FlashMessage } from '@/features/billing/home/flash';
import { OpenCardForm } from '@/features/billing/home/open-card-form';
import { PaymentFocus } from '@/features/billing/home/payment-focus';
import { InviteReturn } from '@/features/billing/home/invite-return';
import { MemberAsk } from '@/features/billing/home/member-ask';
import { AppsSection, DetailsCard, InvoicesPreview, PlanCards, TeamCard, UsageSection } from '@/features/billing/home/sections';
import { TestTools } from '@/features/billing/home/test-tools';
import { memberLine, nextChargeCopy, phaseCopy } from '@/features/billing/phase-copy';

export const metadata: Metadata = { title: 'Billing' };

const BILLING_OFF = 'Billing is not available right now. Nothing will be charged. Please try again later.';

const NOTICES: Readonly<Record<string, FlashMessage>> = {
  plan_updated: { tone: 'success', text: 'Your plan is updated.' },
  trial_started: { tone: 'success', text: 'Your free trial has started. No card needed.' },
  apps_saved: { tone: 'success', text: 'Your trial apps are saved.' },
  canceled: { tone: 'info', text: 'Your plan is set to end. You keep everything until then. You can undo this any time before that day.' },
  // A cancel while a bill was open: the plan ended that day and the bill was dropped (review round 3).
  ended_now: { tone: 'info', text: 'Your plan has ended. The open bill was dropped. We will not charge it. Your data is safe.' },
  paused: { tone: 'info', text: 'Your pause is set. No bills while paused.' },
  kept: { tone: 'success', text: 'Your plan stays on. Nothing changes.' },
  pause_undone: { tone: 'success', text: 'Your pause is off. Your plan carries on as before.' },
  resumed: { tone: 'success', text: 'Your plan is back on. Your apps are open again.' },
  paid: { tone: 'success', text: 'Your payment went through. Your apps are fully open.' },
  details_saved: { tone: 'success', text: 'Your billing details are saved.' },
  card_paid: { tone: 'success', text: 'Card updated. Your payment went through.' },
};

const APP_URL: Readonly<Record<ProductId, () => string>> = {
  crm: () => env.NEXT_PUBLIC_CRM_URL,
  wms: () => env.NEXT_PUBLIC_WMS_URL,
  projects: () => env.NEXT_PUBLIC_PROJECTS_URL,
  pulse: () => env.NEXT_PUBLIC_PULSE_URL,
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Billing home (SPEC 6.1): what am I on, what it costs, the next charge, the card, the invoices. */
export default async function BillingPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await requireBillingContext('/billing');
  const { rt, org, access, timeZone } = context;

  // Old deep links from locked tiles (`/billing?module=crm`) land on the picker with the app on.
  const legacyModule = first(params.module);
  if (legacyModule && isProductId(legacyModule)) redirect(`/billing/plan?add=${legacyModule}`);

  let state: PlanState = await getPlanState(rt, org.id);

  /* ----- a member without billing rights: one card, no amounts, no buttons ----- */
  if (!access.canView) {
    // One click sends the ask (review round 5): the apps that are not in the plan, each with its
    // own button. Under the allow all switch every app is open, so there is nothing to ask for.
    const devOpen = isDevAllowAll();
    const askedToday = devOpen ? [] : await appsAskedToday(org.id, context.session.user.id);
    const askParam = first(params.ask);
    const missing = devOpen
      ? []
      : PRODUCT_IDS.filter((id) => !state.modules[id].inPlan && !(state.modules[id].source === 'manual' && state.modules[id].access === 'full')).map((id) => ({
          id,
          name: CATALOG.products[id].shortName,
          tagline: CATALOG.products[id].tagline,
          askedToday: askedToday.includes(id),
        }));
    return (
      <div className="mx-auto flex max-w-[560px] flex-col gap-6">
        <BillingHeader orgName={org.name} title="Billing" />
        <Card data-testid="billing-member-card" className="flex items-start gap-4 p-6">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-sunken text-icon">
            <ShieldQuestion aria-hidden className="size-5" />
          </span>
          <div>
            <p className="text-base font-semibold text-fg">{memberLine(state, org.name, timeZone, { appsOpen: devOpen })}</p>
            <p className="mt-1 text-sm text-fg-secondary">
              {access.ownerName ? `${access.ownerName} manages billing for ${org.name}.` : `Your organization owner manages billing for ${org.name}.`}
            </p>
            <Link href="/" className="mt-4 inline-flex min-h-9 pointer-coarse:min-h-11 items-center gap-1 text-sm font-semibold text-fg hover:underline">
              Back to my apps
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </Card>
        <MemberAsk
          apps={missing}
          askName={access.ownerName ? firstNameOf(access.ownerName) : null}
          focus={askParam && isProductId(askParam) && missing.some((app) => app.id === askParam) ? askParam : null}
        />
      </div>
    );
  }

  /* ----- back from the card page: pay the open invoice at once (CONTRACTS 11.7) ----- */
  let flash: FlashMessage | null = null;
  const flashKeys = ['notice', 'updated', 'from', 'return'];
  if (first(params.updated) === 'card') {
    if (access.canManage && (state.phase === 'past_due' || state.phase === 'unpaid')) {
      const retried = await retryPayment(rt, { orgId: org.id, actor: context.actor });
      state = await getPlanState(rt, org.id);
      // Paid: load the page again, so the shell's plan banner (read before this payment) and the
      // address bar both show the new state. A reload then never tries the payment a second time.
      if (retried.ok && state.phase !== 'past_due' && state.phase !== 'unpaid') redirect('/billing?notice=card_paid');
      flash = { tone: 'danger', text: retried.ok ? 'Card updated, but the payment did not go through yet. Try Pay now.' : retried.error.message };
    } else {
      flash = { tone: 'success', text: 'Card updated.' };
    }
  }
  const noticeKey = first(params.notice);
  if (!flash && noticeKey && NOTICES[noticeKey]) {
    const from = first(params.from);
    // The way back goes to the page the person left (when the app named one), not to the app's front door.
    const returnPath = appReturnPath(first(params.return));
    const back =
      from && isProductId(from)
        ? { label: `Back to ${CATALOG.products[from].shortName}`, href: `${APP_URL[from]().replace(/\/+$/, '')}${returnPath ?? ''}` }
        : null;
    flash = { ...NOTICES[noticeKey], back };
  }

  // The app a person came from to fix a payment is kept for this tab (the card page drops the
  // link's `from`), so the line that confirms the fix can still say "Back to CRM".
  const cameFrom = first(params.from);
  const rememberFrom = !noticeKey && first(params.updated) !== 'card' && cameFrom && isProductId(cameFrom) ? { from: cameFrom, returnPath: appReturnPath(first(params.return)) } : null;
  const backTargets: FlashBackTargets = Object.fromEntries(
    PRODUCT_IDS.map((id) => [id, { label: `Back to ${CATALOG.products[id].shortName}`, base: APP_URL[id]() }]),
  );
  const cardUpdated = first(params.updated) === 'card' || noticeKey === 'card_paid' || noticeKey === 'paid';

  const [profile, invoices, holders] = await Promise.all([
    getBillingProfile(rt.db, org.id),
    listInvoices(rt.db, { orgId: org.id, limit: 3 }),
    listBillingHolders(rt.db, org.id),
  ]);

  // The allow all switch: every app is open whatever the plan says. It stays on in production until
  // the last go live step (GO-LIVE.md), so real customers see this page with it on. Two rules follow
  // (review round 4): nothing here says "view only" while the apps are open, and no staff words
  // ("Dev override") are shown on a production page.
  const devAllowAll = isDevAllowAll();
  const copy = phaseCopy(state, timeZone, { appsOpen: devAllowAll });
  const billingOff = state.mode === 'unavailable';
  // `fix=payment` is the "Update card" button of an app banner and of the failed payment email.
  // For a person who can change the card it opens the card form at once (review round 5). Everyone
  // else, and `focus=payment` ("Pay the bill instead"), gets the Payment method card in view.
  const fixPayment = first(params.fix) === 'payment' || first(params.focus) === 'payment';
  const openCardForm =
    first(params.fix) === 'payment' && access.canManage && !billingOff && state.hasSubscription && state.paymentMethod !== null && !flash;
  // Billing shows the plan as it is, with one exception: under the switch an app is never marked
  // "View only", because it opens in full. It keeps the badge the launcher gives it ("Included").
  const badges = Object.fromEntries(
    PRODUCT_IDS.map((id) => {
      const badge = planBadgeFor(state, id);
      return [id, devAllowAll && badge === 'view_only' ? 'included' : badge];
    }),
  ) as Record<ProductId, PlanBadge>;
  const canAdd = access.canManage || (access.canStartTrial && (state.phase === 'trial' || state.phase === 'none'));

  return (
    <div data-testid="billing-home" className="flex flex-col gap-6">
      <BillingHeader
        orgName={org.name}
        title="Billing"
        badges={
          <>
            <span data-testid="billing-phase" data-phase={state.phase}>
              <Badge tone={copy.badge.tone}>{copy.badge.label}</Badge>
            </span>
            <TestModeBadge mode={state.mode} />
            {devAllowAll && !isProduction() ? (
              // For the people who build KitStak, on their own machines only. Never on a customer page.
              <Badge tone="info" title="Every app is open on this environment. In production, access follows your plan.">
                <span data-testid="dev-override-badge">Dev override</span>
              </Badge>
            ) : null}
          </>
        }
      />

      {flash ? <Flash message={flash} keys={flashKeys} backTargets={backTargets} /> : null}
      {rememberFrom ? <RememberAppReturn from={rememberFrom.from} returnPath={rememberFrom.returnPath} /> : null}
      {/* Sent here from the invite form to fix a card: the way back to the invite, in this tab only. */}
      {access.canManage ? <InviteReturn cardUpdated={cardUpdated} /> : null}
      {billingOff ? (
        <Notice tone="neutral" role="status" testId="billing-off">
          {BILLING_OFF}
        </Notice>
      ) : null}
      {!access.canManage ? (
        <p className="flex items-center gap-2 text-sm text-fg-secondary">
          <Info aria-hidden className="size-4 shrink-0 text-icon" />
          You can see billing. Only an owner or a billing manager can pay or change a paid plan.
        </p>
      ) : null}

      <PlanCards
        state={state}
        copy={copy}
        nextCharge={nextChargeCopy(state, timeZone, { appsOpen: devAllowAll })}
        canManage={access.canManage}
        canStartTrial={access.canStartTrial}
        billingOff={billingOff}
        highlightPayment={fixPayment}
      />
      {openCardForm ? (
        <OpenCardForm targetId="payment-method" from={rememberFrom?.from ?? null} returnPath={rememberFrom?.returnPath ?? null} />
      ) : fixPayment ? (
        <PaymentFocus targetId="payment-method" />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <UsageSection state={state} canManage={access.canManage} />
          <AppsSection state={state} badges={badges} canAdd={canAdd} />
          {state.mode === 'test_gateway' && access.canManage && state.phase !== 'none' ? (
            <TestTools trialDaysLeft={state.trial?.daysLeft ?? null} hasSubscription={state.hasSubscription} />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <InvoicesPreview invoices={invoices} timeZone={timeZone} />
          <DetailsCard profile={profile} orgName={org.name} canManage={access.canManage} />
          <TeamCard holders={holders} canAssign={access.canAssignManagers} />
          <Link
            href="/billing/activity"
            className="inline-flex min-h-11 items-center justify-between gap-2 rounded-xl border border-border-default bg-panel px-5 text-sm font-semibold text-fg shadow-xs hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Billing activity
            <ArrowRight aria-hidden className="size-4 text-icon" />
          </Link>
        </div>
      </div>
    </div>
  );
}
