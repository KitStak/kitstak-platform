'use client';
/**
 * CRM / WMS link chips for a task (board cards, list rows, table cells). Reads every task link
 * of the project in one request (`useProjectTaskLinks`) and shows the cached record title and
 * live status. Clicking a chip opens the record in the sibling app.
 */
import { useMemo } from 'react';
import { Tooltip, cn } from '@/components/ui';
import { INTEGRATION_TARGET_LABELS, type IntegrationTargetType } from '@/lib/constants';
import { useProjectTaskLinks } from '@/lib/hooks/use-data';
import type { IntegrationLinkDTO } from '@/lib/types';
import { RecordHoverCard } from '@/features/integrations/record-hover-card';
import { statusTone, type StatusTone } from '@/features/integrations/status-tone';

const CRM_TYPES: ReadonlySet<IntegrationTargetType> = new Set(['crm_item', 'crm_account', 'core_customer']);

/** Record titles cached from sibling apps may use a long dash ("Acme \u2014 Plan"); show "Acme · Plan". */
export function cleanTitle(title: string): string {
  return title.replace(/\s*\u2014\s*/g, ' · ');
}

export function isCrmLink(type: IntegrationTargetType): boolean {
  return CRM_TYPES.has(type);
}

/** Every task link of the project grouped by task id. */
export function useTaskLinksMap(projectKey: string): ReadonlyMap<string, readonly IntegrationLinkDTO[]> {
  const links = useProjectTaskLinks(projectKey);
  return useMemo(() => {
    const map = new Map<string, IntegrationLinkDTO[]>();
    for (const link of links.data ?? []) {
      if (!link.taskId) continue;
      const list = map.get(link.taskId);
      if (list) list.push(link);
      else map.set(link.taskId, [link]);
    }
    return map;
  }, [links.data]);
}

function CrmGlyph() {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round">
      <path d="M2 3h12l-4.5 5.2V13l-3 1.5V8.2L2 3Z" />
    </svg>
  );
}

function WmsGlyph() {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round">
      <path d="M8 1.8 14 5v6L8 14.2 2 11V5l6-3.2Z" />
      <path d="M2 5l6 3 6-3M8 8v6.2" />
    </svg>
  );
}

/** Short reference for a pill: the record code before " · " (PO002240), else the title cut to 16 letters. */
export function linkRef(title: string): string {
  const head = title.split(' · ')[0]?.trim() || title;
  return head.length > 16 ? `${head.slice(0, 15).trimEnd()}…` : head;
}

/**
 * `full` shows title and status, `ref` the short record code and status (board cards), `pill` the
 * app mark with a status dot (list rows, where the task title must win the space), `compact` the
 * app mark alone. The tooltip always carries the full record title and status.
 */
export type LinkChipVariant = 'full' | 'ref' | 'pill' | 'compact';

/** Live status colour by meaning (shipped/won green, short/on hold amber, cancelled/lost red). */
const STATUS_DOT: Readonly<Record<StatusTone, string>> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  progress: 'bg-[var(--label-blue)]',
  neutral: 'bg-fg-muted',
};
const STATUS_TEXT: Readonly<Record<StatusTone, string>> = {
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
  progress: 'text-fg-secondary',
  neutral: 'text-fg-muted',
};

export function LinkChip({ link, compact = false, variant }: { readonly link: IntegrationLinkDTO; readonly compact?: boolean; readonly variant?: LinkChipVariant }) {
  const mode: LinkChipVariant = variant ?? (compact ? 'compact' : 'full');
  const crm = isCrmLink(link.targetType);
  const kind = INTEGRATION_TARGET_LABELS[link.targetType];
  const title = cleanTitle(link.title ?? kind);
  const tone = statusTone(link.status);
  const className = cn(
    'inline-flex h-5 max-w-full min-w-0 shrink items-center gap-1 rounded-full border px-1.5 text-2xs font-medium',
    crm ? 'border-[color-mix(in_srgb,var(--label-blue)_35%,transparent)] bg-[color-mix(in_srgb,var(--label-blue)_10%,transparent)] text-fg' : 'border-[color-mix(in_srgb,var(--label-teal)_40%,transparent)] bg-[color-mix(in_srgb,var(--label-teal)_10%,transparent)] text-fg',
  );
  const body = (
    <>
      <span className={cn('inline-flex shrink-0', crm ? 'text-[var(--label-blue)]' : 'text-[var(--label-teal)]')}>{crm ? <CrmGlyph /> : <WmsGlyph />}</span>
      {mode === 'full' ? <span className="truncate">{title}</span> : null}
      {mode === 'ref' ? <span className="truncate font-mono">{linkRef(title)}</span> : null}
      {link.status && (mode === 'full' || mode === 'ref') ? (
        <span className={cn('inline-flex min-w-0 items-center gap-1 truncate', STATUS_TEXT[tone])}>
          <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[tone])} />
          {link.status}
        </span>
      ) : null}
      {link.status && mode === 'pill' ? <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[tone])} /> : null}
      <span className="sr-only">{`${kind}: ${title}${link.status ? `, ${link.status}` : ''}`}</span>
    </>
  );
  return (
    <RecordHoverCard type={link.targetType} id={link.targetId}>
      {link.url ? (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          className={cn(className, 'outline-none hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus')}
          data-testid="link-chip"
        >
          {body}
        </a>
      ) : (
        <span tabIndex={0} className={className} data-testid="link-chip">
          {body}
        </span>
      )}
    </RecordHoverCard>
  );
}

export function LinkChips({ links, max = 2, compact = false, wrap = false, variant, className }: { readonly links: readonly IntegrationLinkDTO[] | undefined; readonly max?: number; readonly compact?: boolean; readonly wrap?: boolean; readonly variant?: LinkChipVariant; readonly className?: string }) {
  if (!links || links.length === 0) return null;
  const shown = links.slice(0, max);
  const more = links.length - shown.length;
  return (
    <span className={cn('flex min-w-0 items-center gap-1', wrap && 'flex-wrap', className)}>
      {shown.map((link) => (
        <LinkChip key={link.id} link={link} compact={compact} variant={variant} />
      ))}
      {more > 0 ? (
        <Tooltip content={links.slice(max).map((link) => `${INTEGRATION_TARGET_LABELS[link.targetType]}: ${cleanTitle(link.title ?? '')}${link.status ? ` · ${link.status}` : ''}`).join(', ')} side="top">
          <span tabIndex={0} className="shrink-0 rounded-full px-1 text-2xs whitespace-nowrap text-fg-muted outline-none focus-visible:outline-2 focus-visible:outline-focus">
            +{more} {more === 1 ? 'link' : 'links'}
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}
