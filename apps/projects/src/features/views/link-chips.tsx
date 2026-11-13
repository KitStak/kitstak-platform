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

const CRM_TYPES: ReadonlySet<IntegrationTargetType> = new Set(['crm_item', 'crm_account', 'core_customer']);

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

export function LinkChip({ link, compact = false }: { readonly link: IntegrationLinkDTO; readonly compact?: boolean }) {
  const crm = isCrmLink(link.targetType);
  const kind = INTEGRATION_TARGET_LABELS[link.targetType];
  const title = link.title ?? kind;
  const tooltip = `${kind}: ${title}${link.status ? ` · ${link.status}` : ''}${link.url ? ' (opens in a new tab)' : ''}`;
  const className = cn(
    'inline-flex h-5 max-w-full min-w-0 shrink items-center gap-1 rounded-full border px-1.5 text-2xs font-medium',
    crm ? 'border-[color-mix(in_srgb,var(--label-blue)_35%,transparent)] bg-[color-mix(in_srgb,var(--label-blue)_10%,transparent)] text-fg' : 'border-[color-mix(in_srgb,var(--label-teal)_40%,transparent)] bg-[color-mix(in_srgb,var(--label-teal)_10%,transparent)] text-fg',
  );
  const body = (
    <>
      <span className={cn('inline-flex shrink-0', crm ? 'text-[var(--label-blue)]' : 'text-[var(--label-teal)]')}>{crm ? <CrmGlyph /> : <WmsGlyph />}</span>
      {compact ? null : <span className="truncate">{title}</span>}
      {link.status && !compact ? <span className="shrink-0 text-fg-muted">· {link.status}</span> : null}
    </>
  );
  return (
    <Tooltip content={tooltip} side="top">
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
    </Tooltip>
  );
}

export function LinkChips({ links, max = 2, compact = false, wrap = false, className }: { readonly links: readonly IntegrationLinkDTO[] | undefined; readonly max?: number; readonly compact?: boolean; readonly wrap?: boolean; readonly className?: string }) {
  if (!links || links.length === 0) return null;
  const shown = links.slice(0, max);
  const more = links.length - shown.length;
  return (
    <span className={cn('flex min-w-0 items-center gap-1', wrap && 'flex-wrap', className)}>
      {shown.map((link) => (
        <LinkChip key={link.id} link={link} compact={compact} />
      ))}
      {more > 0 ? <span className="shrink-0 text-2xs text-fg-muted">+{more}</span> : null}
    </span>
  );
}
