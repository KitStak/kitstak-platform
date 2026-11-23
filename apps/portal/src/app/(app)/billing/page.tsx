import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Info, ShieldQuestion } from 'lucide-react';
import { CATALOG, PRODUCT_IDS, isProductId, type ProductId } from '@kitstak/billing/catalog';
import { planBadgeFor, type PlanBadge, type PlanState } from '@kitstak/billing/plan-state';
import { getBillingProfile, getPlanState, listBillingHolders, listInvoices, retryPayment } from '@kitstak/billing/server';
import { isDevAllowAll } from '@kitstak/entitlements';
import { appReturnPath } from '@/lib/routes';
import { requireBillingContext } from '@/server/billing/context';
import { env } from '@/server/env';
import { Badge, Card, Notice } from '@/components/ui';
import { BillingHeader, TestModeBadge } from '@/features/billing/billing-chrome';
import { Flash, type FlashMessage } from '@/features/billing/home/flash';
import { PaymentFocus } from '@/features/billing/home/payment-focus';
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
    return (
      <div className="mx-auto flex max-w-[560px] flex-col gap-6">
        <BillingHeader orgName={org.name} title="Billing" />
        <Card data-testid="billing-member-card" className="flex items-start gap-4 p-6">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-sunken text-icon">
            <ShieldQuestion aria-hidden className="size-5" />
          </span>
          <div>
            <p className="text-base font-semibold text-fg">{memberLine(state, org.name, timeZone)}</p>
            <p className="mt-1 text-sm text-fg-secondary">
              {access.ownerName ? `Ask ${access.ownerName} to manage billing.` : 'Ask your organization owner to manage billing.'}
            </p>
            <Link href="/" className="mt-4 inline-flex min-h-9 pointer-coarse:min-h-11 items-center gap-1 text-sm font-semibold text-fg hover:underline">
              Back to my apps
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </Card>
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

  const [profile, invoices, holders] = await Promise.all([
    getBillingProfile(rt.db, org.id),
    listInvoices(rt.db, { orgId: org.id, limit: 3 }),
    listBillingHolders(rt.db, org.id),
  ]);

  const devAllowAll = isDevAllowAll();
  const copy = phaseCopy(state, timeZone);
  const billingOff = state.mode === 'unavailable';
  const fixPayment = first(params.fix) === 'payment';
  // Billing shows the plan as it is. The Dev override badge says why every app still opens here.
  const badges = Object.fromEntries(PRODUCT_IDS.map((id) => [id, planBadgeFor(state, id)])) as Record<ProductId, PlanBadge>;
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
            {devAllowAll ? (
              <Badge tone="info" title="Every app is open on this environment. In production, access follows your plan.">
                Dev override
              </Badge>
            ) : null}
          </>
        }
      />

      {flash ? <Flash message={flash} keys={flashKeys} /> : null}
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
        nextCharge={nextChargeCopy(state, timeZone)}
        canManage={access.canManage}
        canStartTrial={access.canStartTrial}
        billingOff={billingOff}
        highlightPayment={fixPayment}
      />
      {fixPayment ? <PaymentFocus targetId="payment-method" /> : null}

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
