'use client';
/**
 * The panel beside the form (1024 px and wider). It fits the page it sits beside (review round 3):
 *
 *   - Signing up (`SignupHero`): reasons to start, every one something the product already does.
 *     One line that says what the person gets, a real picture of the app they chose (light or
 *     dark, like the page), four small pictures that are buttons and swap the big one, "Your free trial" with the chosen apps and
 *     the price that follows it when the link carried a cart, else the four list prices from the
 *     one catalog, and three promises.
 *   - Signing in, a forgotten or a new password (`SignInHero`): the screenshots and "One sign in
 *     for every KitStak app". No prices: this person is not buying.
 *   - Check your email (`TrialHero`): the trial that just started. The apps in it and the day it ends.
 *   - An invite (`InviteHero`): the organization, who sent the invite and the role in plain words.
 *     An invited person never pays, so no price is shown.
 *
 * Which one shows is decided per route by the `@hero` slot of the (auth) layout, on the server.
 * No customer quote and no logo wall: there is no real one to show yet, and nothing here is made up.
 */
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check } from 'lucide-react';
import { AppIcon } from '@kitstak/ui/app-icon';
import { cn } from '@/components/ui';
import { CATALOG, PRODUCT_IDS, formatMoney, percentLabel, priceTermsLabel, unitCents, type ProductId } from '@kitstak/billing/catalog';
import { readHandoff, trialSummary } from '@/features/signup/cart';

/**
 * What each real picture shows. The pictures live in `public/signup/` (1120 x 630, WebP), one
 * light and one dark for each app (review round 5). Each is one part of a real screen, cut close
 * enough that its words can be read at the size of this panel. `line` is the one thing the person
 * gets, said in plain words, and it is true for the picture under it.
 */
const SHOTS: Readonly<Record<ProductId, { readonly line: string; readonly caption: string; readonly alt: string }>> = {
  crm: {
    line: 'See every deal and what it is worth.',
    caption: 'Your pipeline',
    alt: 'KitStak CRM: deals by stage, from lead to won, with the value of each stage.',
  },
  wms: {
    line: 'See every open order and how long it has waited.',
    caption: 'Open orders',
    alt: 'KitStak WMS: open orders and orders in progress, grouped by how many days old they are.',
  },
  projects: {
    line: 'See what is due today and what is late.',
    caption: 'My work',
    alt: 'KitStak Projects: a task list grouped into overdue, today and upcoming.',
  },
  pulse: {
    line: 'See the profit on every job.',
    caption: 'This month',
    alt: 'KitStak Pulse: what the jobs made this month, with revenue and cost.',
  },
};

/** Promises the product keeps today (SPEC 5.3, 6.8 and 8.2). For a person who is about to start. */
const PROMISES: readonly string[] = [
  'See your exact price before you start.',
  `Cancel in two clicks. Or pause a monthly plan for ${CATALOG.pauseMonths[0]} to ${CATALOG.pauseMonths[CATALOG.pauseMonths.length - 1]} months.`,
  'Nothing is deleted when a trial ends.',
];

const CARD = 'rounded-xl border border-white/15 bg-white/[0.07] px-4 py-3.5';
const EYEBROW = 'text-2xs font-semibold tracking-[0.08em] text-white/65 uppercase';

/**
 * One picture in the theme of the page: the light one, or the dark one in the dark theme. Both
 * are lazy, so a browser fetches only the one it shows.
 */
function ShotImage({ product, alt, className }: { readonly product: ProductId; readonly alt: string; readonly className?: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static picture, fetched only when it is shown */}
      <img src={`/signup/${product}-light.webp`} alt={alt} width={1120} height={630} loading="lazy" decoding="async" className={cn('block h-auto w-full dark:hidden', className)} />
      {/* eslint-disable-next-line @next/next/no-img-element -- the same picture in the dark theme */}
      <img src={`/signup/${product}-dark.webp`} alt={alt} width={1120} height={630} loading="lazy" decoding="async" className={cn('hidden h-auto w-full dark:block', className)} />
    </>
  );
}

function Shot({ product }: { readonly product: ProductId }) {
  const shot = SHOTS[product];
  return (
    <figure>
      <div className="overflow-hidden rounded-xl border border-white/15 bg-white shadow-modal dark:bg-[#0d0e10]">
        <ShotImage product={product} alt={shot.alt} />
      </div>
      <figcaption className="mt-2.5 flex items-center gap-2 text-sm text-white/80">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white">
          <AppIcon app={product} size={18} />
        </span>
        <span className="min-w-0 truncate">
          <span className="font-semibold text-white">{CATALOG.products[product].name}</span>
          <span className="text-white/65"> · {shot.caption}</span>
        </span>
      </figcaption>
    </figure>
  );
}

/** The frame of every panel: one line, the picture and its four buttons (when there are any), then the page's own parts. */
function Panel({ products, testId, children }: { readonly products: readonly ProductId[]; readonly testId: string; readonly children: ReactNode }) {
  // The first app of the cart leads. The small pictures are buttons: each puts its app in the big
  // picture. The apps of the cart come first, then the rest.
  const lead = products[0];
  const order = lead ? [...products, ...PRODUCT_IDS.filter((id) => !products.includes(id))] : [];
  const [picked, setPicked] = useState<ProductId | null>(null);
  const active = picked && order.includes(picked) ? picked : lead;
  return (
    // Laptop screens are short: under 860 px of height the small pictures step aside and the panel
    // gets narrower, and narrower again under 760 px, so nothing under the picture is ever cut off.
    <div data-testid={testId} className="relative flex w-full max-w-[520px] flex-col gap-6 text-white [@media(max-height:859px)]:max-w-[440px] [@media(max-height:859px)]:gap-5 [@media(max-height:759px)]:max-w-[380px] [@media(max-height:759px)]:gap-4">
      {active ? (
        <div data-testid="signup-shots" data-app={active}>
          <p data-testid="hero-line" aria-live="polite" className="mb-3 text-xl font-semibold tracking-[-0.01em] text-balance text-white">
            {SHOTS[active].line}
          </p>
          <Shot product={active} />
          <div role="group" aria-label="Pick an app to look at" className="mt-4 grid grid-cols-4 gap-3 [@media(max-height:859px)]:hidden">
            {order.map((product) => {
              const on = product === active;
              return (
                <button
                  key={product}
                  type="button"
                  aria-pressed={on}
                  aria-label={`Show ${CATALOG.products[product].name}`}
                  data-testid={`hero-shot-${product}`}
                  onClick={() => setPicked(product)}
                  className={cn(
                    'group min-w-0 cursor-pointer rounded-lg p-1 text-left transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                    on ? 'bg-white/[0.14]' : 'hover:bg-white/[0.08]',
                  )}
                >
                  <span className={cn('block overflow-hidden rounded-md border bg-white dark:bg-[#0d0e10]', on ? 'border-white' : 'border-white/15 group-hover:border-white/40')}>
                    <ShotImage product={product} alt="" />
                  </span>
                  <span className={cn('mt-1.5 flex items-center gap-1.5 text-2xs font-medium', on ? 'text-white' : 'text-white/75')}>
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-xs bg-white">
                      <AppIcon app={product} size={12} />
                    </span>
                    <span className="min-w-0 truncate font-semibold">{CATALOG.products[product].shortName}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * On a phone the brand panel is not shown. The signup form gets one quiet row instead: a small
 * picture of the app the person chose and the one line that says what they get (review round 5).
 * One row tall, so every field and the button stay on the first screen.
 */
export function SignupTeaser({ products, withCart = false }: { readonly products: readonly ProductId[]; readonly withCart?: boolean }) {
  const product = products[0] ?? 'crm';
  return (
    // With a cart the form already starts with "Your free trial". On a short phone (under 780 px
    // tall) the row then steps aside, so the button stays on the first screen (review round 3).
    <div data-testid="signup-teaser" className={cn('mb-4 flex items-center gap-3 lg:hidden', withCart && '[@media(max-height:779px)]:hidden')}>
      <span className="block w-[84px] shrink-0 overflow-hidden rounded-md border border-border-default bg-panel">
        <ShotImage product={product} alt="" />
      </span>
      <p className="min-w-0 text-sm font-semibold text-pretty text-fg">{SHOTS[product].line}</p>
    </div>
  );
}

function AppChips({ products }: { readonly products: readonly ProductId[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {products.map((product) => (
        <li key={product} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.08] py-0.5 pr-2.5 pl-1 text-xs font-medium text-white">
          <span className="flex size-5 items-center justify-center rounded-full bg-white">
            <AppIcon app={product} size={15} />
          </span>
          {CATALOG.products[product].shortName}
        </li>
      ))}
    </ul>
  );
}

function Ticks({ lines, testId }: { readonly lines: readonly string[]; readonly testId: string }) {
  return (
    <ul data-testid={testId} className="flex flex-col gap-2">
      {lines.map((line) => (
        <li key={line} className="flex items-start gap-2.5 text-sm font-medium text-white">
          <span className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-[var(--surface-brand)]">
            <Check aria-hidden className="size-3" strokeWidth={3.5} />
          </span>
          {line}
        </li>
      ))}
    </ul>
  );
}

/* ===== signing up: the cart from the link, or the list prices ===== */

function ListPrices() {
  return (
    <section data-testid="signup-prices" aria-label="Prices" className={CARD}>
      <p className={EYEBROW}>Prices after your {CATALOG.trialDays} free days</p>
      <dl className="mt-2 flex flex-col gap-1.5">
        {PRODUCT_IDS.map((product) => (
          <div key={product} className="flex items-baseline justify-between gap-4 text-sm">
            <dt className="font-medium text-white">{CATALOG.products[product].shortName}</dt>
            <dd className="text-right text-white/80">
              <span className="font-semibold text-white tabular-nums">{formatMoney(unitCents(product, 'monthly', false), { trimZeroCents: true })}</span>{' '}
              {priceTermsLabel(product, 'monthly')}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2.5 border-t border-white/12 pt-2.5 text-xs text-white/75">
        {percentLabel(CATALOG.bundlePercentOff)} off with {CATALOG.bundleMinProducts} or more apps. {percentLabel(CATALOG.yearlyPercentOff)} off when you pay yearly.
      </p>
    </section>
  );
}

function CartCard({ products, thenLine, monthlyLine, lastLine }: { readonly products: readonly ProductId[]; readonly thenLine: string; readonly monthlyLine: string | null; readonly lastLine: string }) {
  return (
    <section data-testid="signup-plan-summary" aria-label="Your free trial" className={CARD}>
      <p className={EYEBROW}>Your free trial</p>
      <AppChips products={products} />
      <p className="mt-3 text-sm font-medium text-white">{thenLine}</p>
      {monthlyLine ? <p className="text-xs text-white/75">{monthlyLine}</p> : null}
      <p className="mt-1 flex items-center gap-2 text-xs text-white/75">
        <span className="size-2 rounded-full bg-emerald-400" aria-hidden />
        <span data-testid="hero-trial-line">{lastLine}</span>
      </p>
    </section>
  );
}

/** /signup and /signup/company. Reads the cart from the link in the browser. */
export function SignupHero() {
  const summary = trialSummary(readHandoff(useSearchParams()));
  return (
    <Panel products={summary?.products ?? ['crm']} testId="hero-signup">
      {summary ? (
        <CartCard products={summary.products} thenLine={summary.thenLine} monthlyLine={summary.monthlyLine} lastLine={`${CATALOG.trialDays} days free. No card needed.`} />
      ) : (
        <ListPrices />
      )}
      <Ticks lines={PROMISES} testId="signup-promises" />
    </Panel>
  );
}

/** Shown while the link is being read. The same panel with no cart, so nothing jumps. */
export function SignupHeroFallback() {
  return (
    <Panel products={['crm']} testId="hero-signup">
      <ListPrices />
      <Ticks lines={PROMISES} testId="signup-promises" />
    </Panel>
  );
}

/* ===== signing in: no prices ===== */

const SIGN_IN_LINES: readonly string[] = [
  'CRM, WMS, Projects and Pulse open with the same email and password.',
  'Switch apps from the menu at the top. You stay signed in.',
  'Billing for all of them is in one place, the Portal.',
];

/** /login without a cart, /forgot-password, /reset-password and /change-password. */
export function SignInHero() {
  return (
    <Panel products={['crm']} testId="hero-sign-in">
      <section aria-label="One sign in" className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-[-0.01em] text-white">One sign in for every KitStak app</h2>
        <Ticks lines={SIGN_IN_LINES} testId="hero-sign-in-lines" />
      </section>
    </Panel>
  );
}

/** /login: a link from the pricing page can carry a cart. That person is buying, so the cart stays. */
export function LoginHero() {
  const summary = trialSummary(readHandoff(useSearchParams()));
  if (!summary) return <SignInHero />;
  return (
    <Panel products={summary.products} testId="hero-signup">
      <CartCard products={summary.products} thenLine={summary.thenLine} monthlyLine={summary.monthlyLine} lastLine={`${CATALOG.trialDays} days free. No card needed.`} />
      <Ticks lines={PROMISES} testId="signup-promises" />
    </Panel>
  );
}

/* ===== check your email: the trial that just started ===== */

export interface TrialHeroProps {
  readonly products: readonly ProductId[];
  /** "Then $395.20 per month if you add a card." */
  readonly thenLine: string;
  /** Set for yearly carts: "That is $335.92 per month." */
  readonly monthlyLine: string | null;
  /** "Dec 8, 2026", in the person's time zone. */
  readonly endsLabel: string;
}

/** /verify-email for a person whose free trial is running: their apps and the day the trial ends. */
export function TrialHero({ products, thenLine, monthlyLine, endsLabel }: TrialHeroProps) {
  return (
    <Panel products={products} testId="hero-trial">
      <CartCard products={products} thenLine={thenLine} monthlyLine={monthlyLine} lastLine={`Your free trial ends on ${endsLabel}.`} />
      <Ticks lines={['No card needed until then.', PROMISES[2] as string]} testId="hero-trial-lines" />
    </Panel>
  );
}

/* ===== an invite: who, where and as what ===== */

/** What a role may do, in one plain sentence each. The same rules the apps and the Portal apply. */
const ROLE_WORDS: Readonly<Record<string, { readonly label: string; readonly can: string }>> = {
  owner: { label: 'Owner', can: 'You can do everything, billing included.' },
  admin: { label: 'Admin', can: 'You can use the apps, invite people and change roles.' },
  member: { label: 'Member', can: 'You can use the apps your team has.' },
  viewer: { label: 'Viewer', can: 'You can open the apps and look. A viewer does not change records.' },
  guest: { label: 'Guest', can: 'You see only what your team adds you to.' },
  billing: { label: 'Billing only', can: 'You can pay bills, change the card and download invoices.' },
};

export interface InviteHeroProps {
  readonly orgName: string;
  readonly inviterName: string;
  /** The first role as stored: admin, member, viewer, guest or billing. */
  readonly roleKey: string;
  /** The apps the organization has. Empty for a billing only invite, which opens no app. */
  readonly products: readonly ProductId[];
}

/** /invite/[id] for an invite that can still be accepted. Never a price: an invited person does not pay. */
export function InviteHero({ orgName, inviterName, roleKey, products }: InviteHeroProps) {
  const role = ROLE_WORDS[roleKey] ?? { label: roleKey.charAt(0).toUpperCase() + roleKey.slice(1), can: 'An owner or admin of your team decides what you can do.' };
  const billingOnly = roleKey === 'billing';
  const free = billingOnly || roleKey === 'guest';
  return (
    <Panel products={billingOnly ? [] : products} testId="hero-invite">
      <section aria-label="Your invite" className={CARD}>
        <p className={EYEBROW}>You are joining</p>
        {/* A long name wraps. It is never cut with an ellipsis. */}
        <p data-testid="hero-invite-org" className="mt-1.5 text-xl font-semibold tracking-[-0.01em] text-white [overflow-wrap:anywhere]">
          {orgName}
        </p>
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="shrink-0 text-white/70">Invited by</dt>
            <dd className="min-w-0 text-right font-medium text-white [overflow-wrap:anywhere]">{inviterName}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="shrink-0 text-white/70">Your role</dt>
            <dd data-testid="hero-invite-role" className="text-right font-medium text-white">
              {role.label}
            </dd>
          </div>
        </dl>
        <p data-testid="hero-invite-can" className="mt-3 border-t border-white/12 pt-3 text-sm text-white/85">
          {free ? 'Free. ' : ''}
          {role.can}
        </p>
        {!billingOnly && products.length > 0 ? (
          <div className="mt-3">
            <p className="text-xs text-white/70">Your team uses</p>
            <AppChips products={products} />
          </div>
        ) : null}
      </section>
      <Ticks
        lines={
          billingOnly
            ? ['Joining costs you nothing. No card needed.', 'You get Billing in the Portal. You do not get a seat in the apps.']
            : ['Joining costs you nothing. No card needed.', 'One sign in for every app your team has.']
        }
        testId="hero-invite-lines"
      />
    </Panel>
  );
}
