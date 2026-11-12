'use client';
import Link from 'next/link';
import { AlertCircle, CalendarClock, CalendarPlus, ChevronRight, Mail } from 'lucide-react';
import { Button, EmptyState, cn } from '@/components/ui';
import { routes } from '@/features/shell/routes';
import type { ContactRowDto, DealRowDto, DealTotalsDto, NextStepDto, ProfileFieldDto } from '@/server/services/crm-contracts';
import { CrmCard, SoftLabel, StagePill } from '../components/crm-ui';
import { formatDay, formatExactMoney, formatMoney, initials, relativeDay } from '../lib/format';

const rowLink =
  'flex min-w-0 items-center gap-3 rounded-md px-2 py-2 outline-none transition-colors duration-[var(--duration-instant)] hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus';

export function DealsCard({
  deals,
  totals,
  currency,
  orgSlug,
}: {
  readonly deals: readonly DealRowDto[];
  readonly totals: DealTotalsDto;
  readonly currency: string;
  readonly orgSlug: string;
}) {
  return (
    <CrmCard id="crm-deals-card" testId="crm-deals-card" title="Deals" description={`${totals.count} linked`} bodyClassName="p-2 sm:p-3">
      {deals.length === 0 ? (
        <EmptyState size="sm" illustration="board" title="No deals yet" description="Deals linked to this record show up here." />
      ) : (
        <div className="flex flex-col gap-2">
          <dl className="grid grid-cols-3 gap-2 px-2 pt-1 pb-2">
            <Total label="Open" value={formatMoney(totals.openValue, currency)} exact={formatExactMoney(totals.openValue, currency)} />
            <Total label="Weighted" value={formatMoney(totals.weighted, currency)} exact={formatExactMoney(totals.weighted, currency)} tone="primary" />
            <Total label="Won" value={formatMoney(totals.wonValue, currency)} exact={formatExactMoney(totals.wonValue, currency)} tone="success" />
          </dl>
          <ul className="flex flex-col">
            {deals.map((deal) => (
              <li key={deal.id}>
                <Link href={routes.item(orgSlug, deal.boardId, deal.id)} className={cn(rowLink, 'flex-col items-stretch gap-1')}>
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span title={deal.name} className={cn('truncate text-base font-medium', deal.stageKind === 'lost' ? 'text-fg-muted' : 'text-fg')}>
                      {deal.name}
                    </span>
                    <span className="shrink-0 text-base font-semibold tabular-nums text-fg">{formatMoney(deal.value, currency)}</span>
                  </span>
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <StagePill label={deal.stage} className="h-5 text-xs" />
                    <span className="truncate text-xs text-fg-muted">
                      {deal.closeDate ? `Close ${formatDay(deal.closeDate)}` : 'No close date'}
                      {deal.owner ? ` · ${deal.owner.name}` : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </CrmCard>
  );
}

function Total({
  label,
  value,
  exact,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly exact: string;
  readonly tone?: 'primary' | 'success';
}) {
  return (
    <div className="flex flex-col rounded-md bg-sunken px-2.5 py-2" title={exact}>
      <dt className="text-xs text-fg-secondary">{label}</dt>
      <dd
        className={cn(
          'text-md font-semibold tabular-nums',
          tone === 'primary' ? 'text-primary-text' : tone === 'success' ? 'text-success-text' : 'text-fg',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function ContactsCard({
  title,
  contacts,
  orgSlug,
  emptyText,
  testId,
}: {
  readonly title: string;
  readonly contacts: readonly ContactRowDto[];
  readonly orgSlug: string;
  readonly emptyText: string;
  readonly testId?: string;
}) {
  return (
    <CrmCard id={testId} testId={testId} title={title} description={contacts.length > 0 ? `${contacts.length} linked` : undefined} bodyClassName="p-2 sm:p-3">
      {contacts.length === 0 ? (
        <p className="px-2 py-3 text-sm text-fg-muted">{emptyText}</p>
      ) : (
        <ul className="flex flex-col">
          {contacts.map((contact) => (
            <li key={contact.id} className="group/contact relative">
              <Link href={`/${orgSlug}/crm/contacts/${contact.id}`} className={rowLink}>
                <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold text-primary-text">
                  {initials(contact.name)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base font-medium text-fg" title={contact.name}>
                    {contact.name}
                  </span>
                  <span className="truncate text-xs text-fg-muted">
                    {[contact.title, contact.lastContacted ? `Last contacted ${relativeDay(contact.lastContacted)}` : null]
                      .filter(Boolean)
                      .join(' · ') || contact.email}
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-icon" />
              </Link>
              {contact.email ? (
                <a
                  href={`mailto:${contact.email}`}
                  aria-label={`Email ${contact.name}`}
                  className="absolute top-1/2 right-8 hidden size-7 -translate-y-1/2 items-center justify-center rounded-sm text-icon outline-none hover:bg-pressed hover:text-icon-strong focus-visible:flex focus-visible:outline-2 focus-visible:outline-focus group-hover/contact:flex"
                >
                  <Mail aria-hidden className="size-4" />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </CrmCard>
  );
}

export function NextStepsCard({
  steps,
  orgSlug,
  onSchedule,
}: {
  readonly steps: readonly NextStepDto[];
  readonly orgSlug: string;
  /** Opens the composer as a scheduled follow-up (omitted when activities can't be logged). */
  readonly onSchedule?: () => void;
}) {
  return (
    <CrmCard id="crm-next-steps" testId="crm-next-steps" title="Next steps" bodyClassName="p-2 sm:p-3">
      {steps.length === 0 ? (
        <div className="flex flex-col items-start gap-2.5 px-2 py-3">
          <p className="text-sm text-fg-muted">No upcoming activities or open next steps. Schedule a follow-up to keep momentum.</p>
          {onSchedule ? (
            <Button variant="secondary" size="sm" leadingIcon={<CalendarPlus aria-hidden />} onClick={onSchedule} data-testid="crm-schedule-follow-up">
              Schedule follow-up
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="flex flex-col">
          {steps.map((step) => (
            <li key={step.id}>
              <Link href={routes.item(orgSlug, step.boardId, step.itemId)} className={cn(rowLink, 'items-start')}>
                <span
                  className={cn(
                    'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
                    step.overdue ? 'bg-danger-subtle text-danger-text' : 'bg-primary-subtle text-primary-text',
                  )}
                >
                  {step.overdue ? <AlertCircle aria-hidden className="size-3.5" /> : <CalendarClock aria-hidden className="size-3.5" />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="line-clamp-2 text-sm font-medium text-fg" title={step.title}>
                    {step.title}
                  </span>
                  <span className={cn('text-xs', step.overdue ? 'font-medium text-danger-text' : 'text-fg-muted')}>
                    {step.overdue ? 'Overdue · ' : ''}
                    {step.due ? relativeDay(step.due) : 'No date'}
                    {step.kind === 'deal' ? ' · deal next step' : ''}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CrmCard>
  );
}

export function DetailsCard({ fields }: { readonly fields: readonly ProfileFieldDto[] }) {
  if (fields.length === 0) return null;
  return (
    <CrmCard id="crm-details" title="Details">
      <dl className="grid grid-cols-[minmax(96px,auto)_1fr] gap-x-4 gap-y-2.5 text-sm">
        {fields.map((field) => (
          <div key={field.key} className="contents">
            <dt className="truncate text-fg-secondary">{field.label}</dt>
            <dd className="min-w-0 truncate text-fg">
              {field.pill ? (
                <SoftLabel label={field.pill} />
              ) : field.href ? (
                <a
                  href={field.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-sm text-fg-link outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                >
                  {field.value}
                </a>
              ) : (
                <span title={field.value}>{field.value}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </CrmCard>
  );
}

export function AccountCard({
  account,
  orgSlug,
}: {
  readonly account: { readonly id: string; readonly name: string; readonly website: string | null } | null;
  readonly orgSlug: string;
}) {
  return (
    <CrmCard id="crm-account-card" title="Account" bodyClassName="p-2 sm:p-3">
      {account ? (
        <Link href={`/${orgSlug}/crm/accounts/${account.id}`} className={rowLink}>
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-sm font-semibold text-primary-text">
            {initials(account.name)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-base font-medium text-fg" title={account.name}>
              {account.name}
            </span>
            {account.website ? <span className="truncate text-xs text-fg-muted">{account.website.replace(/^https?:\/\/(www\.)?/, '')}</span> : null}
          </span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-icon" />
        </Link>
      ) : (
        <p className="px-2 py-3 text-sm text-fg-muted">Not linked to an account yet. Link one from the board.</p>
      )}
    </CrmCard>
  );
}

