'use client';
/**
 * Hover card for a linked CRM / WMS record. Wrap any chip with it: after a short hover (or when
 * the chip gets keyboard focus) it reads the record live from the sibling app and shows its
 * status, key facts (deal value, stage, units received…) and line items, with a link to open
 * it. The data is re-read every time the card opens if it is older than 30 seconds, so the card
 * is never "checked 9 minutes ago".
 *
 *   <RecordHoverCard type={link.targetType} id={link.targetId}><a …>PO002240</a></RecordHoverCard>
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent, Skeleton, StatusPill, cn } from '@/components/ui';
import { apiGet, apiPath } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { IntegrationTargetType } from '@/lib/constants';
import type { RecordDetail } from '@/lib/types';
import { SiblingAppMark } from './record-chip';
import { TONE_COLOR, statusTone, targetApp } from './status-tone';

const OPEN_DELAY_MS = 350;
const CLOSE_DELAY_MS = 180;

export function useRecordDetail(type: IntegrationTargetType, id: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.recordDetail(type, id),
    queryFn: () => apiGet<RecordDetail>(apiPath('integrations/record', { type, id })),
    enabled: enabled && type !== 'core_customer' && Boolean(id),
    staleTime: 30_000,
    retry: false,
  });
}

const TONE_TEXT = {
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
} as const;

function relative(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function RecordDetailCard({ type, id }: { readonly type: IntegrationTargetType; readonly id: string }) {
  const query = useRecordDetail(type, id, true);
  const app = targetApp(type);
  if (query.isPending) {
    return (
      <div className="flex w-[300px] flex-col gap-2 p-3" aria-busy="true">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    );
  }
  const detail = query.data;
  if (!detail) {
    return (
      <div className="flex w-[280px] items-center gap-2 p-3 text-sm text-fg-secondary">
        <SiblingAppMark app={app} size={14} />
        We couldn’t load this record right now.
      </div>
    );
  }
  return (
    <div className="flex w-[320px] flex-col" data-testid="record-hover-card">
      <div className="flex items-start gap-2 border-b border-border-subtle p-3">
        <SiblingAppMark app={detail.app} size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">{detail.kindLabel}</p>
          <p className="truncate text-sm font-semibold text-fg" title={detail.title}>
            {detail.title}
          </p>
        </div>
        {detail.status ? <StatusPill label={detail.status} color={TONE_COLOR[statusTone(detail.status)]} className="shrink-0" /> : null}
      </div>
      {detail.facts.length ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 p-3">
          {detail.facts.map((entry) => (
            <div key={entry.label} className="min-w-0">
              <dt className="text-2xs text-fg-muted">{entry.label}</dt>
              <dd className={cn('truncate text-sm font-medium text-fg tabular-nums', entry.tone && TONE_TEXT[entry.tone])} title={entry.value}>
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {detail.lines.length ? (
        <div className="border-t border-border-subtle px-3 pt-2 pb-1">
          <p className="pb-1 text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">{detail.linesLabel ?? 'Lines'}</p>
          <ul className="flex flex-col">
            {detail.lines.map((line, index) => (
              <li key={`${line.label}-${index}`} className="flex items-baseline gap-2 py-1 text-xs">
                <span className="min-w-0 flex-1 truncate text-fg" title={line.sku ? `${line.label} (${line.sku})` : line.label}>
                  {line.label}
                  {line.sku ? <span className="ml-1 font-mono text-fg-muted">{line.sku}</span> : null}
                </span>
                <span className={cn('shrink-0 tabular-nums text-fg-secondary', line.tone && TONE_TEXT[line.tone])}>{line.value}</span>
              </li>
            ))}
          </ul>
          {detail.moreLines > 0 ? <p className="pb-1 text-2xs text-fg-muted">and {detail.moreLines} more</p> : null}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-3 py-2">
        <span className="text-2xs text-fg-muted">Live from {detail.app === 'crm' ? 'CRM' : 'WMS'} · {relative(detail.checkedAt)}</span>
        <a
          href={detail.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-fg-link hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          Open in {detail.app === 'crm' ? 'CRM' : 'WMS'}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </a>
      </div>
    </div>
  );
}

/**
 * Opens the live record card on hover / focus of its child (the chip). The child must accept a
 * ref and pointer/focus handlers (an <a>, <span> or <button>).
 */
export function RecordHoverCard({
  type,
  id,
  children,
  side = 'top',
  className,
}: {
  readonly type: IntegrationTargetType;
  readonly id: string;
  readonly children: ReactElement;
  readonly side?: 'top' | 'bottom' | 'left' | 'right';
  /** Classes for the wrapper around the child (e.g. `flex-1` inside a row). */
  readonly className?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = useCallback(() => {
    clear();
    timer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  }, []);
  const hide = useCallback(() => {
    clear();
    timer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, []);
  useEffect(() => clear, []);
  if (type === 'core_customer') return children;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span
          className={cn('inline-flex max-w-full min-w-0', className)}
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse') show();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') hide();
          }}
          onFocus={show}
          onBlur={hide}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          {children}
        </span>
      </PopoverAnchor>
      <PopoverContent
        flush
        side={side}
        align="start"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={clear}
        onPointerLeave={hide}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {open ? <RecordDetailCard type={type} id={id} /> : null}
      </PopoverContent>
    </Popover>
  );
}
