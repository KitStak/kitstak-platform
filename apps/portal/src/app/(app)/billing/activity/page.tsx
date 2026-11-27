import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  CircleAlert,
  CircleCheck,
  CreditCard,
  Download,
  FlaskConical,
  History,
  Layers,
  Mail,
  PauseCircle,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { getPlanState } from '@kitstak/billing/server';
import { requireBillingContext } from '@/server/billing/context';
import { Card, LinkButton, cn, ScrollRow } from '@/components/ui';
import { BillingHeader, TestModeBadge } from '@/features/billing/billing-chrome';
import {
  ACTIVITY_FILTERS,
  EMPTY_COPY,
  groupByDay,
  invoiceIdOf,
  isActivityFilter,
  kindOf,
  timeLabel,
  toneOf,
  type ActivityFilter,
  type ActivityTone,
  foldRepeats,
} from '@/features/billing-activity/model';
import { countActivity, listActivity } from '@/features/billing-activity/query';

export const metadata: Metadata = { title: 'Billing activity' };

const PAGE_SIZE = 30;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function hrefFor(filter: ActivityFilter, before?: string): string {
  const params = new URLSearchParams();
  if (filter !== 'all') params.set('show', filter);
  if (before) params.set('before', before);
  const query = params.toString();
  return `/billing/activity${query ? `?${query}` : ''}`;
}

/**
 * Event icons sit in one neutral circle (docs/design/UI-CLEANUP.md: no tinted icon tiles). Only the
 * glyph of a payment that worked or failed takes its status color.
 */
const TONE_CLASS: Readonly<Record<ActivityTone, string>> = {
  success: 'border-border-subtle bg-sunken text-success-text',
  danger: 'border-border-subtle bg-sunken text-danger-text',
  warning: 'border-border-subtle bg-sunken text-icon',
  info: 'border-border-subtle bg-sunken text-icon',
  neutral: 'border-border-subtle bg-sunken text-icon',
};

function iconFor(action: string): LucideIcon {
  if (action === 'payment.succeeded' || action === 'payment.retried') return CircleCheck;
  if (action === 'payment.failed') return CircleAlert;
  if (action === 'card.updated') return CreditCard;
  if (action === 'email.sent') return Mail;
  if (action === 'test.tool') return FlaskConical;
  if (action === 'manager.added' || action === 'manager.removed') return UserRound;
  if (action === 'plan.paused' || action === 'pause.scheduled') return PauseCircle;
  return Layers;
}

const KIND_WORDS = { payments: 'Payment', plan: 'Plan change', emails: 'Email' } as const;

/**
 * Billing activity (docs/billing/SPEC.md section 8.6): everything that happened to the plan, newest
 * first, in plain sentences. Who did it, when, and for payments a link to the invoice. Owners,
 * admins and billing managers can read it.
 */
export default async function BillingActivityPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await requireBillingContext('/billing/activity');
  const { rt, org, access, timeZone } = context;
  if (!access.canView) redirect('/billing');

  const wanted = first(params.show);
  const filter: ActivityFilter = isActivityFilter(wanted) ? wanted : 'all';
  const beforeParam = first(params.before);
  const beforeDate = beforeParam ? new Date(beforeParam) : null;
  const before = beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : undefined;

  const [state, counts, found] = await Promise.all([
    getPlanState(rt, org.id),
    countActivity(org.id),
    listActivity({ orgId: org.id, filter, limit: PAGE_SIZE + 1, ...(before ? { before } : {}) }),
  ]);
  const items = found.slice(0, PAGE_SIZE);
  const last = items[items.length - 1];
  const hasMore = found.length > PAGE_SIZE && last !== undefined;
  // The same press repeated (a checkout started again and again) reads as one row with a count.
  const days = groupByDay(foldRepeats(items), rt.now(), timeZone);
  const empty = EMPTY_COPY[filter];

  return (
    <div data-testid="billing-activity" className="flex flex-col gap-6">
      <BillingHeader
        orgName={org.name}
        title="Billing activity"
        description="Everything that happened to your plan, newest first. Who did it, when, and what changed."
        badges={<TestModeBadge mode={state.mode} />}
        actions={
          counts.all > 0 ? (
            <a
              href={`/billing/activity/export${filter === 'all' ? '' : `?show=${filter}`}`}
              data-testid="activity-export"
              className={cn(
                'inline-flex h-10 items-center gap-1.5 rounded-md border border-border-input bg-panel px-4 text-base font-medium text-fg',
                'hover:border-border-input-hover hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              )}
            >
              <Download aria-hidden className="size-5" />
              Download CSV
            </a>
          ) : null
        }
      />

      <ScrollRow as="nav" aria-label="Show" className="-mx-4 px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-2">
          {ACTIVITY_FILTERS.map((entry) => {
            const active = entry.id === filter;
            return (
              <li key={entry.id}>
                <Link
                  href={hrefFor(entry.id)}
                  aria-current={active ? 'page' : undefined}
                  data-testid={`activity-filter-${entry.id}`}
                  className={cn(
                    // `relative`: the screen reader only words inside stay within this tab. Without it they
                    // sit outside the scrolling row and make the whole page scroll sideways on a phone.
                    'relative inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    active
                      ? 'border-border-strong bg-selected text-fg'
                      : 'border-border-default bg-panel text-fg-secondary hover:bg-hover hover:text-fg',
                  )}
                >
                  {entry.label}
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-2xs font-semibold tabular-nums',
                      active ? 'bg-panel text-fg' : 'bg-sunken text-fg-muted',
                    )}
                  >
                    <span className="sr-only">, </span>
                    {counts[entry.id]}
                    <span className="sr-only"> {counts[entry.id] === 1 ? 'event' : 'events'}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </ScrollRow>

      {items.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-sunken text-icon">
            <History aria-hidden className="size-6" />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-fg">{before ? 'No older activity.' : empty.title}</h2>
          <p className="mt-1 max-w-sm text-sm text-fg-secondary">{before ? 'You have seen it all.' : empty.body}</p>
          <LinkButton href={before || filter !== 'all' ? hrefFor(before ? filter : 'all') : '/billing'} variant="secondary" size="lg" className="mt-5">
            {before ? 'Back to the newest' : filter !== 'all' ? 'Show all activity' : 'Back to Billing'}
          </LinkButton>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {days.map((day) => (
            <section key={day.key} aria-labelledby={`activity-day-${day.key}`}>
              <h2 id={`activity-day-${day.key}`} className="mb-2 text-2xs font-semibold tracking-[0.08em] text-fg-muted uppercase">
                {day.label}
              </h2>
              <Card as="div" className="overflow-hidden">
                <ol className="divide-y divide-border-subtle">
                  {day.items.map((item) => {
                    const Icon = iconFor(item.action);
                    const invoiceId = invoiceIdOf(item.data);
                    return (
                      <li
                        key={item.id}
                        data-testid="activity-row"
                        data-action={item.action}
                        // On phones the invoice link sits under the words, so the sentence keeps the full
                        // width and never breaks in the middle of a word.
                        className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 px-4 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-5"
                      >
                        <span
                          aria-hidden
                          className={cn('mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full border', TONE_CLASS[toneOf(item.action)])}
                        >
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-md font-medium [overflow-wrap:anywhere] text-fg">
                            {item.summary}
                            {'times' in item && typeof item.times === 'number' && item.times > 1 ? (
                              <span data-testid="activity-times" className="ml-2 inline-flex items-center rounded-full bg-sunken px-2 py-0.5 align-middle text-xs font-semibold text-fg-secondary tabular-nums">
                                {item.times} times
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-fg-secondary">
                            <span className="sr-only">{KIND_WORDS[kindOf(item.action)]}. </span>
                            <time dateTime={item.at.toISOString()}>{timeLabel(item.at, timeZone)}</time>
                            <span aria-hidden>·</span>
                            <span>By {item.actorLabel}</span>
                          </p>
                        </div>
                        {invoiceId ? (
                          <Link
                            href={`/billing/invoices/${invoiceId}`}
                            aria-label={`View the invoice for: ${item.summary}`}
                            className={cn(
                              'col-start-2 inline-flex min-h-9 items-center justify-self-start rounded-md text-sm font-medium text-fg underline decoration-border-strong underline-offset-4 sm:col-start-3 sm:justify-self-end sm:px-2 pointer-coarse:min-h-11',
                              'hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                            )}
                          >
                            View invoice
                          </Link>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </Card>
            </section>
          ))}
        </div>
      )}

      {hasMore && last ? (
        <div className="flex justify-center">
          <LinkButton href={hrefFor(filter, last.at.toISOString())} variant="secondary" size="lg">
            Older activity
          </LinkButton>
        </div>
      ) : null}
      {before && items.length > 0 ? (
        <div className="flex justify-center">
          <Link
            href={hrefFor(filter)}
            className="inline-flex min-h-9 pointer-coarse:min-h-11 items-center rounded-md text-sm font-medium text-fg-secondary hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Back to the newest
          </Link>
        </div>
      ) : null}
    </div>
  );
}
