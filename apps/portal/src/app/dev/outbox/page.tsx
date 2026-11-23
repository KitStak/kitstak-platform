import Link from 'next/link';
import { ArrowLeft, Inbox, LayoutTemplate, Mail, Search } from 'lucide-react';
import { deliverQueuedEmails, getOutboxEmail, listOutbox, resolveEmailProvider, type OutboxRow } from '@kitstak/billing/emails';
import { Badge, Card, cn } from '@/components/ui';
import { db } from '@/server/db';
import { mailEnv } from '../../api/billing/jobs/mail-env';
import { AutoRefresh } from './_components/auto-refresh';
import { EmailPreview } from './_components/email-preview';
import { codeIn, outboxTime, statusWords, templateLabel, timeAgo } from './_components/words';

const LIST_SIZE = 100;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function hrefFor(open: string | null, to: string): string {
  const params = new URLSearchParams();
  if (to) params.set('to', to);
  if (open) params.set('open', open);
  const query = params.toString();
  return `/dev/outbox${query ? `?${query}` : ''}`;
}

/**
 * The dev email outbox (docs/billing/SPEC.md section 10). Outside production, with no mail key,
 * every email KitStak would send is kept here instead: the subject, the HTML and the text, newest
 * first. Opening the page also delivers anything still waiting, so a code shows up at once and no
 * job has to run locally. In production this page does not exist (see the layout).
 */
export default async function OutboxPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const to = (first(params.to) ?? '').trim().toLowerCase().slice(0, 200);
  const openId = first(params.open) ?? null;
  const env = mailEnv();
  const provider = resolveEmailProvider(env);

  let deliverProblem: string | null = null;
  if (provider === 'outbox') {
    try {
      await deliverQueuedEmails(db, { limit: 200, env });
    } catch (error) {
      console.error('[portal] the dev outbox could not deliver queued emails', error);
      deliverProblem = 'We could not deliver the waiting emails. Check that the database is running, then refresh.';
    }
  }

  let rows: readonly OutboxRow[] = [];
  let listProblem: string | null = null;
  try {
    rows = await listOutbox(db, { limit: LIST_SIZE, ...(to ? { to } : {}) });
  } catch (error) {
    console.error('[portal] the dev outbox could not list emails', error);
    listProblem = 'We could not load the emails. Check that the database is running, then refresh.';
  }

  let selected: OutboxRow | null = null;
  if (openId) selected = rows.find((row) => row.id === openId) ?? (await getOutboxEmail(db, openId).catch(() => null));
  selected ??= rows[0] ?? null;
  const now = new Date();
  const selectedCode = selected ? codeIn(selected.template, selected.text) : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-muted">Local development</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-fg">Email outbox</h1>
          <p className="mt-1.5 max-w-2xl text-md text-fg-secondary">
            Every email KitStak would send is kept here. Nothing leaves your machine. Open one to read the code or use its button.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/dev/outbox/templates"
            className={cn(
              'inline-flex h-10 items-center gap-1.5 rounded-md border border-border-input bg-panel px-3 text-sm font-medium text-fg',
              'hover:border-border-input-hover hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            )}
          >
            <LayoutTemplate aria-hidden className="size-4" />
            All templates
          </Link>
          <AutoRefresh />
        </div>
      </header>

      {provider === 'resend' ? (
        <p role="status" className="rounded-lg border border-info/25 bg-info-subtle px-4 py-3 text-sm font-medium text-info-text">
          A Resend key is set, so new emails go to real inboxes. Only the send log shows here, without the email body.
        </p>
      ) : null}
      {deliverProblem || listProblem ? (
        <p role="alert" className="rounded-lg border border-danger/25 bg-danger-subtle px-4 py-3 text-sm font-medium text-danger-text">
          {deliverProblem ?? listProblem}
        </p>
      ) : null}

      <form action="/dev/outbox" method="get" role="search" className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="outbox-to" className="sr-only">
          Show emails to one address
        </label>
        <div className="flex h-11 w-full items-center gap-2 rounded-md border border-border-input bg-panel px-3 focus-within:border-border-strong sm:max-w-md">
          <Search aria-hidden className="size-4 shrink-0 text-icon" />
          <input
            id="outbox-to"
            name="to"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={to}
            placeholder="Show emails to one address"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-placeholder"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Show
          </button>
          {to ? (
            <Link
              href="/dev/outbox"
              className="inline-flex h-11 items-center rounded-md border border-border-input bg-panel px-4 text-sm font-medium text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Show all
            </Link>
          ) : null}
        </div>
      </form>

      {rows.length === 0 && !selected ? (
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-sunken text-icon">
            <Inbox aria-hidden className="size-6" />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-fg">{to ? 'No emails to that address yet.' : 'No emails yet.'}</h2>
          <p className="mt-1 max-w-sm text-sm text-fg-secondary">
            Sign up, invite someone or start a free trial. The emails show up here within seconds.
          </p>
          <Link
            href={to ? '/dev/outbox' : '/signup'}
            className="mt-5 inline-flex h-10 items-center rounded-md border border-border-input bg-panel px-4 text-sm font-medium text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {to ? 'Show all emails' : 'Go to sign up'}
          </Link>
        </Card>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
          <Card as="div" className={cn('overflow-hidden', openId ? 'order-2 lg:order-1' : 'order-1')}>
            <h2 className="border-b border-border-subtle bg-sunken px-4 py-2.5 text-2xs font-semibold tracking-[0.08em] text-fg-muted uppercase">
              {rows.length === 1 ? '1 email' : `${rows.length} emails`}
              {rows.length === LIST_SIZE ? ', newest shown' : ''}
            </h2>
            <ul className="max-h-none divide-y divide-border-subtle lg:max-h-[760px] lg:overflow-y-auto">
              {rows.map((row) => {
                const active = selected?.id === row.id;
                const status = statusWords(row.status);
                return (
                  <li key={row.id} data-testid="outbox-row" data-template={row.template} data-to={row.to}>
                    <Link
                      href={hrefFor(row.id, to)}
                      scroll={false}
                      data-testid={`outbox-open-${row.id}`}
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'block min-h-11 px-4 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                        active ? 'bg-selected' : 'hover:bg-hover',
                      )}
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-semibold text-fg">{row.subject ?? templateLabel(row.template)}</span>
                        <time dateTime={row.createdAt.toISOString()} title={outboxTime(row.createdAt)} className="shrink-0 text-xs text-fg-muted">
                          {timeAgo(row.createdAt, now)}
                        </time>
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-fg-secondary">To {row.to}</span>
                      <span className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge tone="neutral">{templateLabel(row.template)}</Badge>
                        {row.status === 'sent' ? null : <Badge tone={status.tone}>{status.label}</Badge>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>

          <section aria-label="Selected email" className={cn('min-w-0', openId ? 'order-1 lg:order-2' : 'order-2')}>
            {selected ? (
              <Card as="div" className="p-4 sm:p-6">
                {openId ? (
                  <Link
                    href={hrefFor(null, to)}
                    className="mb-3 inline-flex min-h-9 items-center gap-1.5 rounded-md text-sm font-medium text-fg-secondary hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:hidden"
                  >
                    <ArrowLeft aria-hidden className="size-4" />
                    All emails
                  </Link>
                ) : null}
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 hidden size-10 shrink-0 items-center justify-center rounded-full bg-sunken text-icon sm:inline-flex">
                    <Mail aria-hidden className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 data-testid="outbox-subject" className="text-lg font-semibold tracking-[-0.01em] break-words text-fg">
                      {selected.subject ?? templateLabel(selected.template)}
                    </h2>
                    <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-fg-secondary">
                      <div className="flex gap-1.5">
                        <dt className="text-fg-muted">To</dt>
                        <dd data-testid="outbox-to" className="break-all font-medium text-fg">
                          {selected.to}
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-fg-muted">When</dt>
                        <dd>{outboxTime(selected.sentAt ?? selected.createdAt)}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-fg-muted">Kind</dt>
                        <dd>{templateLabel(selected.template)}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
                <div className="mt-5">
                  {selected.html || selected.text ? (
                    <EmailPreview key={selected.id} html={selected.html} text={selected.text} code={selectedCode} />
                  ) : (
                    <p role="status" className="rounded-lg border border-border-default bg-sunken px-4 py-6 text-center text-sm text-fg-secondary">
                      {selected.status === 'queued'
                        ? 'This email is waiting to go out. Refresh in a moment.'
                        : selected.status === 'sent'
                          ? 'This email went to a real inbox. Its body is not stored here.'
                          : 'This email was not sent, so there is nothing to show.'}
                    </p>
                  )}
                </div>
              </Card>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
