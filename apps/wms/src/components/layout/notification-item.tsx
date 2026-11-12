'use client';

import * as React from 'react';
import { AlertTriangle, Check, CheckCircle2, Info, Trash2, XCircle } from 'lucide-react';
import { useFormat } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface NotificationView {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string | null;
  readonly href: string | null;
  readonly severity: 'info' | 'success' | 'warning' | 'error';
  readonly readAt: string | null;
  readonly createdAt: string;
}

const SEVERITY_ICON = {
  info: { icon: Info, className: 'text-info bg-info-soft' },
  success: { icon: CheckCircle2, className: 'text-success bg-success-soft' },
  warning: { icon: AlertTriangle, className: 'text-warning bg-warning-soft' },
  error: { icon: XCircle, className: 'text-danger bg-danger-soft' },
} as const;

/**
 * Display severity: a "success" that achieved nothing (e.g. a wave that completed with
 * `0 allocated`) is shown as a warning, so a zero-result run never looks like a green success.
 * Producers should send the right severity (requested); this guards older rows.
 */
export function displaySeverity(
  n: Pick<NotificationView, 'severity' | 'title' | 'body'>,
): NotificationView['severity'] {
  if (n.severity !== 'success') return n.severity;
  const text = `${n.title} ${n.body ?? ''}`;
  return /(^|[^\d,.])0 allocated\b/i.test(text) ? 'warning' : 'success';
}

/** One notification row; used by the header bell and the /notifications page. */
export function NotificationItem({
  notification: n,
  onOpen,
  onMarkRead,
  onDelete,
  typeLabel,
  compact,
}: {
  readonly notification: NotificationView;
  readonly onOpen: () => void;
  readonly onMarkRead: () => void;
  readonly onDelete?: () => void;
  readonly typeLabel?: string;
  readonly compact?: boolean;
}) {
  const format = useFormat();
  const severity = SEVERITY_ICON[displaySeverity(n)] ?? SEVERITY_ICON.info;
  const Icon = severity.icon;
  const unread = n.readAt === null;
  return (
    <li className={cn('group flex items-start gap-2.5 px-3 py-2.5', unread ? 'bg-primary-soft/40' : '')}>
      <span
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          severity.className,
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-focus/30"
      >
        <span className={cn('block text-sm text-foreground', unread ? 'font-semibold' : 'font-medium')}>
          {n.title}
        </span>
        {n.body ? (
          <span className={cn('block text-xs text-secondary', compact ? 'line-clamp-2' : '')}>{n.body}</span>
        ) : null}
        <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-faint">
          {typeLabel ? (
            <span className="rounded bg-neutral-soft px-1.5 py-px font-medium text-secondary">
              {typeLabel}
            </span>
          ) : null}
          <time dateTime={n.createdAt} title={format.gridDateTime(n.createdAt)}>
            {compact
              ? format.age(n.createdAt) === 'now'
                ? 'just now'
                : `${format.age(n.createdAt)} ago`
              : format.gridDateTime(n.createdAt)}
          </time>
        </span>
      </button>
      {unread ? (
        <button
          type="button"
          aria-label={`Mark "${n.title}" as read`}
          onClick={onMarkRead}
          className="rounded p-1 text-faint opacity-70 hover:bg-surface hover:text-primary group-hover:opacity-100"
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          aria-label={`Delete "${n.title}"`}
          onClick={onDelete}
          className="rounded p-1 text-faint opacity-70 hover:bg-surface hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30 group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </li>
  );
}
