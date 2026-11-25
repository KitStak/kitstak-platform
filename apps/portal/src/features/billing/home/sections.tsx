/**
 * The parts of billing home (SPEC 6.1). Server components: they lay out a `PlanState` and never do
 * their own math. Amounts come from `quote()` and from the gateway through the plan state.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, CalendarClock, CreditCard, FileText, Layers, Receipt, UsersRound, Wallet } from 'lucide-react';
import { AppIcon } from '@kitstak/ui/app-icon';
import { CATALOG, PRODUCT_IDS, formatDay, formatMoney, percentLabel, type ProductId } from '@kitstak/billing/catalog';
import { quote as quoteFor } from '@kitstak/billing/quote';
import { PLAN_BADGE_LABELS, creditLine, type PlanBadge, type PlanState } from '@kitstak/billing/plan-state';
import type { BillingManagerRow, BillingProfile, InvoiceRow } from '@kitstak/billing/server';
import { Badge, Card, Eyebrow, LinkButton, cn } from '@/components/ui';
import {
  addAppPriceNote,
  cardExpiry,
  cardLabel,
  oneSeatSavingCents,
  oneWarehouseSavingCents,
  perPeriod,
  planToShow,
  plural,
  usesSeats,
} from '../format';
import { invoiceStatus, invoiceTitle } from '../invoices/invoice-words';
import type { PhaseCopy } from '../phase-copy';
import { HomeActionButton } from './home-actions';
import { MathDialog } from './math-dialog';

export const BADGE_TONE: Readonly<Record<PlanBadge, 'info' | 'success' | 'warning' | 'danger' | 'neutral'>> = {
  trial: 'info',
  active: 'success',
  past_due: 'warning',
  view_only: 'danger',
  not_in_plan: 'neutral',
  included: 'success',
};

function CardShell({
  title,
  icon,
  testId,
  id,
  highlight = false,
  children,
}: {
  readonly title: string;
  readonly icon: ReactNode;
  readonly testId: string;
  readonly id?: string;
  readonly highlight?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Card
      id={id}
      data-testid={testId}
      aria-label={title}
      className={cn('flex scroll-mt-24 flex-col p-5 sm:min-h-[212px]', highlight && 'ring-2 ring-focus ring-offset-2 ring-offset-app')}
    >
      <div className="flex items-center gap-2">
        <span className="text-icon [&_svg]:size-4">{icon}</span>
        <Eyebrow>{title}</Eyebrow>
      </div>
      {children}
    </Card>
  );
}

function AppChip({ product, muted = false, note }: { readonly product: ProductId; readonly muted?: boolean; readonly note?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border border-border-default bg-sunken pr-2.5 pl-1 text-xs font-semibold text-fg',
        muted && 'opacity-70',
      )}
    >
      <AppIcon app={product} size={20} />
      {CATALOG.products[product].shortName}
      {note ? <span className="font-medium text-fg-muted">{note}</span> : null}
    </span>
  );
}

/* ===== the four cards ===== */

export interface PlanCardsProps {
  readonly state: PlanState;
  readonly copy: PhaseCopy;
  readonly nextCharge: { readonly headline: string; readonly detail: string };
  readonly canManage: boolean;
  readonly canStartTrial: boolean;
  readonly billingOff: boolean;
  readonly highlightPayment: boolean;
}

export function PlanCards({ state, copy, nextCharge, canManage, canStartTrial, billingOff, highlightPayment }: PlanCardsProps) {
  const inPlan = PRODUCT_IDS.filter((id) => state.modules[id].inPlan);
  const included = PRODUCT_IDS.filter((id) => !state.modules[id].inPlan && state.modules[id].source === 'manual' && state.modules[id].access === 'full');
  const shown = inPlan.length > 0 ? inPlan : state.selection.products;
  const hasPlanShape = shown.length > 0 && state.phase !== 'none';
  // With no paid plan the cards show the plan the team can buy: the saved cart, with a seat for
  // every person. So home, the picker, the review step and the pay page all say one total.
  const plan = planToShow(state);
  const quote = plan === state.selection ? state.quote : quoteFor(plan);
  const facts: string[] = [];
  if (hasPlanShape) {
    if (usesSeats(plan)) facts.push(plural(plan.seats, 'seat', 'seats'));
    if (plan.products.includes('wms')) facts.push(plural(plan.warehouses, 'warehouse', 'warehouses'));
    facts.push(plan.interval === 'yearly' ? 'Yearly' : 'Monthly');
  }
  // Admins can read billing and can start or change a trial. Paid plans need an owner or a billing manager.
  const trialStep = copy.primary.id === 'start_trial' || copy.primary.id === 'change_apps';
  const mayAct = (id: PhaseCopy['primary']['id']) => canManage || (canStartTrial && (id === 'start_trial' || id === 'change_apps'));
  const primaryAllowed = mayAct(copy.primary.id);
  const others = copy.others.filter((action) => mayAct(action.id));
  const showCost = hasPlanShape && quote.lines.length > 0;
  const costLabel = state.phase === 'trial' || (state.phase === 'active' && state.trial) ? 'After your trial' : undefined;
  const method = state.paymentMethod;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <CardShell title="Plan" icon={<Layers aria-hidden />} testId="billing-plan-card">
        <div className="mt-3 flex flex-wrap gap-1.5">
          {hasPlanShape ? shown.map((id) => <AppChip key={id} product={id} />) : null}
          {included.map((id) => (
            <AppChip key={id} product={id} note="Included" />
          ))}
          {!hasPlanShape && included.length === 0 ? <span className="text-lg font-semibold text-fg">No plan yet</span> : null}
        </div>
        {facts.length > 0 ? <p className="mt-2 text-sm text-fg-secondary">{facts.join(' · ')}</p> : null}
        <p className="mt-2 text-sm font-medium text-fg">{copy.line}</p>
        <div className="mt-auto flex flex-col gap-2 pt-4">
          {primaryAllowed ? (
            <HomeActionButton action={copy.primary} variant="primary" size="xl" fullWidth withTestId billingOff={billingOff} />
          ) : !trialStep ? (
            <p className="text-xs text-fg-muted">
              {copy.primary.id === 'pick_plan'
                ? 'Only an owner or a billing manager can pick a plan and pay.'
                : 'Only an owner or a billing manager can change the plan.'}
            </p>
          ) : null}
          {copy.primary.id === 'resume_now' && primaryAllowed && quote.lines.length > 0 ? (
            <p className="text-xs text-fg-muted">
              Starting now bills {formatMoney(quote.totalCents)} today and opens your apps at once.
            </p>
          ) : null}
          {others.length > 0 ? (
            <div className="flex flex-wrap gap-x-1 gap-y-1">
              {others.map((action) => (
                <HomeActionButton
                  key={action.id}
                  action={action}
                  variant={action.id === 'pay_now' || !primaryAllowed ? 'secondary' : 'ghost'}
                  size="lg"
                  withTestId
                  billingOff={billingOff}
                  className={action.id === 'pay_now' || !primaryAllowed ? 'text-sm' : 'px-2.5 text-sm'}
                />
              ))}
            </div>
          ) : null}
        </div>
      </CardShell>

      <CardShell title="Cost" icon={<Wallet aria-hidden />} testId="billing-cost">
        {showCost ? (
          <>
            <p className="mt-3 text-xl font-semibold tracking-[-0.02em] text-fg tabular-nums">
              {formatMoney(quote.totalCents)} <span className="text-sm font-medium tracking-normal text-fg-secondary">{perPeriod(quote.interval)}</span>
            </p>
            {quote.periodMonths === 12 ? (
              <p className="mt-0.5 text-sm text-fg-secondary">That is {formatMoney(quote.monthlyEquivalentCents)} per month.</p>
            ) : null}
            <p className="mt-2 text-sm text-fg-secondary">
              {costLabel ? 'This is your price after the free trial. ' : ''}
              {quote.isBundle ? `Includes your ${percentLabel(CATALOG.bundlePercentOff)} bundle discount.` : ''}
              {!quote.isBundle && !costLabel ? 'Before tax, if any applies.' : ''}
            </p>
            <div className="mt-auto pt-4">
              <MathDialog quote={quote} totalLabel={costLabel} />
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-xl font-semibold tracking-[-0.02em] text-fg tabular-nums">{formatMoney(0)}</p>
            <p className="mt-2 text-sm text-fg-secondary">
              {included.length > 0 ? 'Your apps are included. There is nothing to pay.' : 'You pay nothing until you pick a plan.'}
            </p>
          </>
        )}
      </CardShell>

      <CardShell title="Next charge" icon={<CalendarClock aria-hidden />} testId="billing-next-charge">
        <p className="mt-3 text-xl font-semibold tracking-[-0.02em] text-fg">{nextCharge.headline}</p>
        <p className="mt-2 text-sm text-fg-secondary">{nextCharge.detail}</p>
        {creditLine(state) ? (
          <p data-testid="billing-credit" className="mt-2 text-sm font-medium text-success-text">
            {creditLine(state)}
          </p>
        ) : null}
      </CardShell>

      <CardShell title="Payment method" icon={<CreditCard aria-hidden />} testId="billing-payment-method" id="payment-method" highlight={highlightPayment}>
        {method ? (
          <>
            <p className="mt-3 text-lg font-semibold text-fg">{cardLabel(method)}</p>
            <p className="mt-1 text-sm text-fg-secondary">Expires {cardExpiry(method)}</p>
          </>
        ) : (
          <>
            <p className="mt-3 text-lg font-semibold text-fg">No card yet</p>
            <p className="mt-1 text-sm text-fg-secondary">
              {state.phase === 'trial' ? 'You do not need one during your free trial. You add it when you pick a plan.' : 'You add one when you pick a plan.'}
            </p>
          </>
        )}
        {canManage ? (
          <div className="mt-auto pt-4">
            {/* The Plan card holds the one filled "Pick a plan" button of this row. No second button here. */}
            {method && state.hasSubscription ? (
              <HomeActionButton action={{ id: 'update_card', label: 'Update card' }} variant="secondary" size="lg" billingOff={billingOff} />
            ) : null}
          </div>
        ) : null}
      </CardShell>
    </div>
  );
}

/* ===== usage ===== */

/**
 * A bar for "how much of what I pay for is in use". `held` is a second, lighter part for things
 * that hold a place without using it yet (open invites hold a seat). `text` is what a screen
 * reader says, so the two parts are told apart in words, never by color alone.
 */
function Meter({ used, held = 0, total, label, text }: { readonly used: number; readonly held?: number; readonly total: number; readonly label: string; readonly text?: string }) {
  const share = (count: number): number => (total <= 0 ? 0 : Math.min(100, (count / total) * 100));
  const usedPercent = share(used);
  const heldPercent = Math.min(100 - usedPercent, share(held));
  const full = used + held >= total;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.min(used + held, total)}
      aria-valuetext={text ?? `${used + held} of ${total} in use`}
      className="flex h-2 w-full overflow-hidden rounded-full bg-sunken"
    >
      <div className={cn('h-full', heldPercent > 0 ? 'rounded-l-full' : 'rounded-full', full ? 'bg-warning' : 'bg-primary')} style={{ width: `${usedPercent}%` }} />
      {heldPercent > 0 ? (
        <div data-testid="meter-held" className={cn('h-full rounded-r-full opacity-45', usedPercent === 0 && 'rounded-l-full', full ? 'bg-warning' : 'bg-primary')} style={{ width: `${heldPercent}%` }} />
      ) : null}
    </div>
  );
}

export function UsageSection({ state, canManage }: { readonly state: PlanState; readonly canManage: boolean }) {
  const { usage, selection } = state;
  const period = perPeriod(selection.interval);
  const perUser = usesSeats(selection) && state.hasSubscription;
  const pulseSeats = CATALOG.products.pulse.includedSeats ?? 0;
  const pulseOnly = state.hasSubscription && !usesSeats(selection) && selection.products.includes('pulse');

  // Open invites hold a seat, so they count as in use: the number, the bar and the hint all agree.
  const seatsHeld = usage.seatsUsed + usage.pendingInvites;
  const seatParts = `${plural(usage.seatsUsed, 'person', 'people')} and ${plural(usage.pendingInvites, 'open invite', 'open invites')}.`;

  let seatHint: ReactNode = null;
  if (usage.seatsPaid === null) {
    seatHint =
      state.phase === 'trial'
        ? 'No seat limit during your free trial. Guests are always free.'
        : 'Seats are counted when you pick a plan. Guests are always free.';
  } else if (pulseOnly) {
    seatHint =
      seatsHeld >= pulseSeats
        ? `Pulse covers up to ${pulseSeats} seats. For a bigger team, talk to us.`
        : `Pulse covers up to ${pulseSeats} seats for one price.`;
  } else if (perUser) {
    const held = seatsHeld;
    const saving = oneSeatSavingCents(selection);
    if (usage.seatsPaid > held && saving > 0) {
      seatHint = `You pay for ${plural(usage.seatsPaid, 'seat', 'seats')} and use ${held}. Remove a seat to save ${formatMoney(saving)} ${period}.`;
    } else if (usage.seatsPaid <= held) {
      seatHint = 'Every seat is in use. Add a seat before you invite someone new.';
    }
  }

  let warehouseHint: ReactNode = null;
  if (usage.warehousesPaid !== null && usage.warehousesUsed !== null) {
    const saving = oneWarehouseSavingCents(selection);
    if (usage.warehousesPaid > usage.warehousesUsed && saving > 0) {
      warehouseHint = `You pay for ${plural(usage.warehousesPaid, 'warehouse', 'warehouses')} and use ${usage.warehousesUsed}. Remove one to save ${formatMoney(saving)} ${period}.`;
    } else if (usage.warehousesPaid <= usage.warehousesUsed) {
      warehouseHint = 'Every warehouse in your plan is in use.';
    }
  }
  const showWarehouses = state.modules.wms.inPlan || usage.warehousesUsed !== null;

  return (
    <Card aria-labelledby="billing-usage-heading" className="p-5">
      <Eyebrow id="billing-usage-heading">Usage</Eyebrow>
      <div className="mt-4 flex flex-col gap-5">
        <div data-testid="billing-usage-seats">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-fg">
              {usage.seatsPaid !== null
                ? `Seats: ${seatsHeld} of ${usage.seatsPaid} in use`
                : `Seats: ${plural(usage.seatsUsed, 'person', 'people')} on your team`}
            </p>
            {canManage && perUser ? (
              <Link href="/billing/plan?focus=seats" className="shrink-0 text-sm font-semibold text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg">
                Change seats
              </Link>
            ) : null}
          </div>
          {usage.seatsPaid !== null ? (
            <div className="mt-2">
              <Meter
                used={usage.seatsUsed}
                held={usage.pendingInvites}
                total={usage.seatsPaid}
                label="Seats in use"
                text={usage.pendingInvites > 0 ? `${seatsHeld} of ${usage.seatsPaid} in use: ${seatParts}` : undefined}
              />
            </div>
          ) : null}
          {usage.pendingInvites > 0 ? (
            <p className="mt-2 text-xs text-fg-muted" data-testid="billing-usage-seat-parts">
              {usage.seatsPaid !== null
                ? `${seatParts} An open invite holds a seat.`
                : usage.pendingInvites === 1
                  ? '1 invite is waiting.'
                  : `${usage.pendingInvites} invites are waiting.`}
            </p>
          ) : null}
          {seatHint ? <p className="mt-2 text-sm text-fg-secondary">{seatHint}</p> : null}
        </div>

        {showWarehouses ? (
          <div data-testid="billing-usage-warehouses" className="border-t border-border-subtle pt-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold text-fg">
                {usage.warehousesPaid !== null
                  ? `Warehouses: ${usage.warehousesUsed ?? 0} of ${usage.warehousesPaid} used`
                  : usage.warehousesUsed === null
                    ? 'Warehouses: none set up yet'
                    : `Warehouses: ${plural(usage.warehousesUsed, 'warehouse', 'warehouses')} in the WMS`}
              </p>
              {canManage && usage.warehousesPaid !== null ? (
                <Link href="/billing/plan?focus=warehouses" className="shrink-0 text-sm font-semibold text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg">
                  Change warehouses
                </Link>
              ) : null}
            </div>
            {usage.warehousesPaid !== null ? (
              <div className="mt-2">
                <Meter used={usage.warehousesUsed ?? 0} total={usage.warehousesPaid} label="Warehouses used" />
              </div>
            ) : null}
            {warehouseHint ? <p className="mt-2 text-sm text-fg-secondary">{warehouseHint}</p> : null}
            {usage.warehousesPaid !== null && usage.warehousesUsed === null ? (
              <p className="mt-2 text-sm text-fg-secondary">No warehouse is set up yet. Open the WMS to add your first one.</p>
            ) : null}
            {usage.warehousesPaid === null && state.phase === 'trial' ? (
              <p className="mt-2 text-sm text-fg-secondary">No warehouse limit during your free trial.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/* ===== your apps ===== */

export interface AppsSectionProps {
  readonly state: PlanState;
  readonly badges: Readonly<Record<ProductId, PlanBadge>>;
  /** May add an app: a billing manager, or an admin during a trial or before one. */
  readonly canAdd: boolean;
}

export function AppsSection({ state, badges, canAdd }: AppsSectionProps) {
  return (
    <Card aria-labelledby="billing-apps-heading" className="overflow-hidden">
      <div className="px-5 pt-5">
        <Eyebrow id="billing-apps-heading">Your apps</Eyebrow>
      </div>
      <ul className="mt-2 divide-y divide-border-subtle">
        {PRODUCT_IDS.map((id) => {
          const pricing = CATALOG.products[id];
          const plan = state.modules[id];
          const badge = badges[id];
          const addable = !plan.inPlan && plan.source !== 'manual';
          const priceNote = addable ? addAppPriceNote(state, id) : null;
          return (
            <li key={id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
              <span className={cn('inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-sunken', badge === 'not_in_plan' && 'opacity-60 grayscale')}>
                <AppIcon app={id} size={34} />
              </span>
              <div className="min-w-0 flex-1 basis-40">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                  {pricing.name}
                  <Badge tone={BADGE_TONE[badge]}>{PLAN_BADGE_LABELS[badge]}</Badge>
                </p>
                <p className="mt-0.5 text-sm text-fg-secondary">{priceNote ?? pricing.tagline}</p>
              </div>
              {addable && canAdd ? (
                <LinkButton href={`/billing/plan?add=${id}`} variant="secondary" size="lg" aria-label={`Add ${pricing.shortName}`}>
                  Add
                </LinkButton>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* ===== right column ===== */

export function InvoicesPreview({ invoices, timeZone }: { readonly invoices: readonly InvoiceRow[]; readonly timeZone: string }) {
  return (
    <Card data-testid="billing-invoices-preview" aria-labelledby="billing-invoices-heading" className="p-5">
      <div className="flex items-center gap-2">
        <Receipt aria-hidden className="size-4 text-icon" />
        <Eyebrow id="billing-invoices-heading">Invoices</Eyebrow>
      </div>
      {invoices.length === 0 ? (
        <p className="mt-3 text-sm text-fg-secondary">
          No invoices yet.{' '}
          {/* No invoice is made without a payment, so a trial with no card never promises one. */}
          Your first one arrives with your first payment.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border-subtle">
          {invoices.map((invoice) => {
            const status = invoiceStatus(invoice);
            return (
              <li key={invoice.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link href={`/billing/invoices/${invoice.id}`} className="block truncate text-sm font-semibold text-fg hover:underline">
                    {formatDay(invoice.issuedAt, timeZone)}
                  </Link>
                  <p className="truncate text-xs text-fg-muted">{invoiceTitle(invoice)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-fg tabular-nums">{formatMoney(invoice.totalCents)}</p>
                  <p className={cn('text-xs font-medium', status.tone === 'success' ? 'text-success-text' : status.tone === 'warning' ? 'text-warning-text' : 'text-fg-muted')}>
                    {status.label}
                  </p>
                </div>
                <a
                  href={`/billing/invoices/${invoice.id}/pdf`}
                  target="_blank"
                  rel="noopener"
                  aria-label={`PDF of the invoice from ${formatDay(invoice.issuedAt, timeZone)}`}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-icon pointer-coarse:size-11 hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <FileText aria-hidden className="size-4" />
                </a>
              </li>
            );
          })}
        </ul>
      )}
      <Link href="/billing/invoices" className="mt-3 inline-flex min-h-9 pointer-coarse:min-h-11 items-center gap-1 text-sm font-semibold text-fg hover:underline">
        See all invoices
        <ArrowRight aria-hidden className="size-4" />
      </Link>
    </Card>
  );
}

export function DetailsCard({ profile, orgName, canManage }: { readonly profile: BillingProfile; readonly orgName: string; readonly canManage: boolean }) {
  const rows: readonly [string, string][] = [
    ['Company', profile.companyName ?? orgName],
    ['Billing email', profile.billingEmail ?? 'Not set. Receipts go to owners and billing managers.'],
    ['Tax ID', profile.taxIdValue ?? 'Not set'],
  ];
  return (
    <Card aria-labelledby="billing-details-heading" className="p-5">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow id="billing-details-heading">Billing details</Eyebrow>
        <Link href="/billing/details" className="inline-flex min-h-9 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-end items-center text-sm font-semibold text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg">
          {canManage ? 'Edit' : 'View'}
        </Link>
      </div>
      <dl className="mt-2 flex flex-col gap-2.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-fg-muted">{label}</dt>
            <dd className="font-medium break-words text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function TeamCard({ holders, canAssign }: { readonly holders: readonly BillingManagerRow[]; readonly canAssign: boolean }) {
  const first = holders[0];
  const others = holders.length - 1;
  const line = !first
    ? 'Nobody can manage billing yet.'
    : others <= 0
      ? `${first.name} can manage billing.`
      : `${first.name} and ${others} ${others === 1 ? 'other' : 'others'} can manage billing.`;
  return (
    <Card aria-labelledby="billing-team-heading" className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UsersRound aria-hidden className="size-4 text-icon" />
          <Eyebrow id="billing-team-heading">Billing team</Eyebrow>
        </div>
        <Link href="/billing/team" className="inline-flex min-h-9 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-end items-center text-sm font-semibold text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg">
          {canAssign ? 'Manage' : 'View'}
        </Link>
      </div>
      <p className="mt-2 text-sm font-medium text-fg">{line}</p>
      {holders.length === 1 ? <p className="mt-1 text-sm text-fg-secondary">Add a second person so billing never gets stuck.</p> : null}
    </Card>
  );
}
