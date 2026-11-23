import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Lock } from 'lucide-react';
import { CATALOG, PRODUCT_IDS, formatDay, isProductId, normalizeSelection, toStack, type PlanSelection, type ProductId } from '@kitstak/billing/catalog';
import { canStartTrial, getPlanState } from '@kitstak/billing/server';
import { appReturnPath } from '@/lib/routes';
import { requireBillingContext } from '@/server/billing/context';
import { LinkButton, Notice } from '@/components/ui';
import { BackLink, BillingHeader, BillingMessage, TestModeBadge } from '@/features/billing/billing-chrome';
import { PlanPicker, type PlanPickerProps } from '@/features/billing/plan-picker/plan-picker';

export const metadata: Metadata = { title: 'Plan' };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const HEADING: Readonly<Record<PlanPickerProps['mode'], { title: string; description: string }>> = {
  trial: { title: 'Pick your apps', description: `Try them free for ${CATALOG.trialDays} days. No card needed.` },
  trial_change: { title: 'Change your trial apps', description: 'Add or remove apps any time. Apps you add share the same trial end date.' },
  checkout: { title: 'Pick your plan', description: 'Choose your apps, seats and how often you pay. You review everything before you pay.' },
  change: { title: 'Change your plan', description: 'Changes start right away. You pay only for the days left, and you see the amount first.' },
};

/** The picker in the billing shell (SPEC 6.2). It opens in the right mode by itself. */
export default async function PlanPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await requireBillingContext('/billing/plan');
  const { rt, org, access, session, timeZone } = context;
  if (!access.canView) redirect('/billing');

  const state = await getPlanState(rt, org.id);

  // During a free trial the picker has two jobs, and each gets its own screen with one filled button:
  //   "Pick a plan" (the banner, billing home, the emails, the setup guide) opens it to pay: apps,
  //   seats, pay period, then "Continue to review".
  //   "Change trial apps" and "Add <app>" open it to change what is in the trial: "Save my apps".
  // A person who may change trial apps but may not pay (an admin) always gets the second one.
  const wantsApps = first(params.apps) === '1' || first(params.add) !== undefined;
  let mode: PlanPickerProps['mode'];
  if (state.hasSubscription) mode = 'change';
  else if (state.phase === 'trial') mode = wantsApps || !access.canManage ? 'trial_change' : 'checkout';
  else if (state.phase === 'none') {
    const eligible = await canStartTrial(rt.db, { orgId: org.id, userId: session.user.id });
    mode = eligible.ok ? 'trial' : 'checkout';
  } else mode = 'checkout';

  // Paying and changing a paid plan need an owner or a billing manager. Admins can read.
  if ((mode === 'change' || mode === 'checkout') && !access.canManage) {
    return (
      <BillingMessage
        icon={<Lock aria-hidden className="size-6" />}
        title="Only an owner or a billing manager can change the plan"
        actions={
          <LinkButton href="/billing" size="xl">
            Back to Billing
          </LinkButton>
        }
      >
        {access.ownerName ? `Ask ${access.ownerName} to change it or to make you a billing manager.` : 'Ask your organization owner to change it.'}
      </BillingMessage>
    );
  }

  // Links can prefill the picker. Every value is clamped. No link can carry a price.
  const add = first(params.add);
  const focusParam = first(params.focus);
  const from = first(params.from);
  const base = state.selection;
  // Changing trial apps starts from the apps the trial has now. The saved cart (a plan the person
  // started to pick) only lends its seats and pay period.
  const inTrial = PRODUCT_IDS.filter((id) => state.modules[id].inPlan);
  const baseProducts = mode === 'trial_change' && inTrial.length > 0 ? inTrial : base.products;
  const products = add && isProductId(add) && state.modules[add].source !== 'manual' ? toStack([...baseProducts, add]) : baseProducts;
  const prefilled: PlanSelection = normalizeSelection({
    products: [...products],
    seats: first(params.seats) ?? base.seats,
    warehouses: first(params.warehouses) ?? base.warehouses,
    interval: first(params.interval) ?? base.interval,
  });
  let focus: PlanPickerProps['focus'];
  if (focusParam === 'seats' || focusParam === 'warehouses' || focusParam === 'interval') focus = focusParam;
  else if (first(params.seats)) focus = 'seats';
  else if (first(params.warehouses)) focus = 'warehouses';
  else if (add && isProductId(add)) focus = add as ProductId;

  const cameFrom = from && isProductId(from) ? from : null;
  // The app can name the page to come back to (the WMS warehouses page). Only a plain path is kept.
  const returnPath = cameFrom ? appReturnPath(first(params.return)) : null;
  const doneNotice = mode === 'change' ? 'plan_updated' : mode === 'trial_change' ? 'apps_saved' : mode === 'trial' ? 'trial_started' : null;
  const doneHref =
    cameFrom && doneNotice
      ? `/billing?notice=${doneNotice}&from=${cameFrom}${returnPath ? `&return=${encodeURIComponent(returnPath)}` : ''}`
      : undefined;
  const heading = HEADING[mode];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <BackLink href="/billing">Billing</BackLink>
        <BillingHeader
          orgName={org.name}
          title={heading.title}
          description={
            mode === 'checkout' && state.phase === 'trial' && state.trial
              ? `Choose your apps, seats and how often you pay. No charge until your free trial ends on ${formatDay(state.trial.endsAt, timeZone)}.`
              : heading.description
          }
          badges={<TestModeBadge mode={state.mode} />}
        />
      </div>
      {!context.emailVerified && (mode === 'change' || mode === 'checkout') ? (
        <Notice
          tone="info"
          action={
            <LinkButton href="/verify-email?next=/billing/plan" variant="secondary" size="lg">
              Enter code
            </LinkButton>
          }
        >
          Verify your email first. It takes one minute.
        </Notice>
      ) : null}
      <PlanPicker
        // A new link (another app, another number) gives a fresh picker.
        key={`${mode}:${prefilled.products.join(',')}:${prefilled.seats}:${prefilled.warehouses}:${prefilled.interval}`}
        mode={mode}
        initialSelection={prefilled}
        planState={state}
        focus={focus}
        doneHref={doneHref}
        layout="billing"
        timeZone={timeZone}
        canPay={access.canManage}
      />
    </div>
  );
}
