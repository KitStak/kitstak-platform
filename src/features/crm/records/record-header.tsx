'use client';
import type { ReactNode } from 'react';
import '../crm.css';
import Link from 'next/link';
import { Building2, Copy, ExternalLink, Globe, Mail, NotebookPen, Phone } from 'lucide-react';
import {
  AvatarGroup,
  Button,
  IconButton,
  Tooltip,
  buttonVariants,
  cn,
  toast,
} from '@/components/ui';
import { routes } from '@/features/shell/routes';
import type { Record360Dto } from '@/server/services/crm-contracts';
import { SoftLabel } from '../components/crm-ui';
import { initials, relativeDay } from '../lib/format';

async function copy(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${what} copied`, value);
  } catch {
    toast.error(`Couldn’t copy ${what.toLowerCase()}`, 'Your browser blocked clipboard access.');
  }
}

function QuickAction({
  icon,
  label,
  value,
  href,
  copyLabel,
  external,
  testId,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly href: string;
  readonly copyLabel: string;
  readonly external?: boolean;
  readonly testId?: string;
}) {
  return (
    <div className="group/qa flex h-9 min-w-0 max-w-full items-center rounded-md border border-border-subtle bg-panel pr-0.5 transition-colors duration-[var(--duration-fast)] hover:border-border-default">
      <Tooltip content={label}>
        <a
          href={href}
          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          data-testid={testId}
          className="flex h-full min-w-0 items-center gap-2 rounded-l-md px-2.5 text-sm text-fg outline-none hover:bg-hover hover:text-primary-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          <span className="text-icon [&_svg]:size-4">{icon}</span>
          <span className="truncate">{value}</span>
        </a>
      </Tooltip>
      <IconButton size="xs" label={`Copy ${copyLabel.toLowerCase()}`} icon={<Copy aria-hidden />} onClick={() => void copy(value, copyLabel)} />
    </div>
  );
}

export function RecordHeader({
  record,
  orgSlug,
  onLogActivity,
  canLog,
  composerOpen = false,
}: {
  readonly record: Record360Dto;
  readonly orgSlug: string;
  readonly onLogActivity: () => void;
  readonly canLog: boolean;
  readonly composerOpen?: boolean;
}) {
  const isAccount = record.kind === 'accounts';
  const subtitle =
    record.kind === 'contacts'
      ? [record.title, record.account?.name].filter(Boolean)
      : [record.domain, record.fields.find((field) => field.key === 'hq')?.value].filter(Boolean);
  return (
    <section
      aria-label={`${record.name} profile`}
      data-testid="crm-record-header"
      className="crm-record-header relative overflow-hidden rounded-lg border border-border-subtle bg-panel"
    >
      <div className="flex flex-col gap-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span
              aria-hidden
              className={cn(
                'flex size-12 shrink-0 items-center justify-center bg-pressed text-lg font-medium text-fg-secondary sm:size-16 sm:text-xl',
                isAccount ? 'rounded-xl' : 'rounded-full',
              )}
            >
              {initials(record.name)}
            </span>
            <div className="min-w-0 pb-0.5">
              <h1
                className="line-clamp-2 break-words font-heading text-xl font-semibold tracking-[-0.01em] text-fg sm:text-2xl"
                title={record.name}
              >
                {record.name}
              </h1>
              {/* Stacked on phones (no dangling separator), inline with a dot from sm up. */}
              <p className="flex min-w-0 flex-col items-start gap-x-2 text-base text-fg-secondary sm:flex-row sm:flex-wrap sm:items-center">
                {record.kind === 'contacts' && record.title ? (
                  <span className="max-w-full truncate" title={record.title}>
                    {record.title}
                  </span>
                ) : null}
                {record.kind === 'contacts' && record.account ? (
                  <>
                    {record.title ? (
                      <span aria-hidden className="hidden text-fg-muted sm:inline">
                        ·
                      </span>
                    ) : null}
                    <Link
                      href={`/${orgSlug}/crm/accounts/${record.account.id}`}
                      className="inline-flex items-center gap-1 rounded-sm font-medium text-fg-link outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      <Building2 aria-hidden className="size-3.5" />
                      {record.account.name}
                    </Link>
                  </>
                ) : null}
                {record.kind === 'accounts' && subtitle.length > 0 ? <span className="truncate">{subtitle.join(' · ')}</span> : null}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {record.owners.length > 0 ? (
              <span className="mr-1 flex min-w-0 items-center gap-2 text-sm text-fg-secondary" data-testid="crm-record-owner">
                <span>Owner</span>
                <AvatarGroup people={record.owners.map((owner) => ({ id: owner.id, name: owner.name, src: owner.image }))} size="sm" />
                {record.owners.length === 1 && record.owners[0] ? (
                  <span className="max-w-32 truncate font-medium text-fg" title={record.owners[0].name}>
                    {record.owners[0].name}
                  </span>
                ) : null}
              </span>
            ) : null}
            <Link
              href={routes.item(orgSlug, record.board.id, record.id)}
              className={buttonVariants({ variant: 'secondary' })}
              data-testid="crm-open-in-board"
            >
              <ExternalLink aria-hidden />
              Open in board
            </Link>
            {canLog ? (
              <Button
                leadingIcon={<NotebookPen aria-hidden />}
                onClick={onLogActivity}
                aria-controls={composerOpen ? 'crm-activity-composer' : undefined}
                aria-expanded={composerOpen}
                data-testid="crm-log-activity"
              >
                Log activity
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {record.kind === 'contacts' && record.email ? (
            <QuickAction icon={<Mail />} label="Send email" value={record.email} href={`mailto:${record.email}`} copyLabel="Email" testId="crm-email-action" />
          ) : null}
          {record.kind === 'contacts' && record.phone ? (
            <QuickAction icon={<Phone />} label="Call" value={record.phone} href={`tel:${record.phone.replace(/[^\d+]/g, '')}`} copyLabel="Phone" />
          ) : null}
          {record.kind === 'accounts' && record.website && /^https?:\/\//i.test(record.website) ? (
            <QuickAction icon={<Globe />} label="Open website" value={record.domain ?? record.website} href={record.website} copyLabel="Website" external />
          ) : null}
          {record.tags.map((tag) => (
            <SoftLabel key={`${tag.id}-${tag.name}`} label={tag} />
          ))}
          <span className="ml-auto text-xs text-fg-muted">
            {record.kind === 'contacts' && record.lastContacted ? `Last contacted: ${relativeDay(record.lastContacted)} · ` : ''}
            Updated: {relativeDay(record.updatedAt.slice(0, 10))}
          </span>
        </div>
      </div>
    </section>
  );
}
