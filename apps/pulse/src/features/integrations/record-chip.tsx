'use client';
/**
 * A chip for one linked sibling record (CRM deal, work order, project): the app's mark, the
 * record's name and its status right now. It opens the record in its own app in a new tab.
 *
 * Give it the copy stored on the link and, when you have it, the live record from
 * `useLiveRecords`. While the live read is on its way the stored copy shows; when the app
 * cannot be read the chip says so and keeps the stored copy; when the record is gone it says that.
 *
 *   const live = useLiveRecords(links.map((link) => ({ type: link.targetType, id: link.targetId })));
 *   <RecordChip type={link.targetType} id={link.targetId} title={link.title} status={link.status} url={link.url} live={findLive(live.data, link)} loading={live.isPending} />
 */
import { ArrowUpRight, CircleSlash, CloudOff } from 'lucide-react';
import { AppIcon } from '@kitstak/ui/app-icon';
import { Tooltip, cn } from '@/components/ui';
import type { LinkTargetType } from '@/lib/constants';
import { SIBLING_APP_NAMES, TARGET_WORDS, appOfTarget, type LiveRecordDTO, type RecordTone } from './types';

const TONE: Readonly<Record<RecordTone, string>> = {
  good: 'bg-success-subtle text-success-text',
  warn: 'bg-warning-subtle text-warning-text',
  bad: 'bg-danger-subtle text-danger-text',
  info: 'bg-info-subtle text-info-text',
  quiet: 'bg-muted text-fg-secondary',
};

export function findLive(
  records: readonly LiveRecordDTO[] | undefined,
  ref: { readonly targetType: LinkTargetType; readonly targetId: string },
): LiveRecordDTO | undefined {
  return records?.find((record) => record.type === ref.targetType && record.id === ref.targetId);
}

export function RecordStatus({
  status,
  tone,
  live,
}: {
  readonly status: string;
  readonly tone: RecordTone;
  readonly live: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-xs font-medium',
        TONE[tone],
      )}
      data-live={live ? '' : undefined}
    >
      {live ? <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" /> : null}
      {status}
    </span>
  );
}

export interface RecordChipProps {
  readonly type: LinkTargetType;
  readonly id: string;
  /** The copy stored on the link. */
  readonly title?: string | null;
  readonly status?: string | null;
  readonly url?: string | null;
  /** The record as it is right now, when it has been read. */
  readonly live?: LiveRecordDTO;
  /** The live read is still on its way. */
  readonly loading?: boolean;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

export function RecordChip({
  type,
  id,
  title,
  status,
  url,
  live,
  loading,
  size = 'md',
  className,
}: RecordChipProps) {
  const app = appOfTarget(type);
  const isLive = live?.state === 'live';
  const gone = live?.state === 'gone';
  const offline =
    live?.state === 'offline' &&
    (type === 'crm_deal' || type === 'crm_account' || type === 'wms_work_order' || type === 'pm_project');
  const shownTitle = (isLive ? live.title : null) ?? title ?? `${TARGET_WORDS[type]} ${id.slice(0, 8)}`;
  const shownStatus = isLive ? live.status : gone ? null : (status ?? null);
  const href = gone ? null : ((isLive ? live.url : null) ?? url ?? null);
  const tone: RecordTone = isLive ? live.tone : 'quiet';
  const tip = gone
    ? `This ${TARGET_WORDS[type].toLowerCase()} is no longer in ${SIBLING_APP_NAMES[app]}.`
    : offline
      ? `${SIBLING_APP_NAMES[app]} cannot be read right now. This is the last copy Pulse saved.`
      : `${TARGET_WORDS[type]} in ${SIBLING_APP_NAMES[app]}${isLive && live.detail ? `: ${live.detail}` : ''}${href ? '. Opens in a new tab.' : ''}`;
  const body = (
    <>
      <AppIcon app={app} size={size === 'sm' ? 16 : 18} className="-mx-0.5" />
      <span className={cn('min-w-0 truncate font-medium', gone ? 'text-fg-muted line-through' : 'text-fg')}>
        {shownTitle}
      </span>
      {gone ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-muted">
          <CircleSlash aria-hidden className="size-3.5" />
          No longer there
        </span>
      ) : shownStatus ? (
        <RecordStatus status={shownStatus} tone={tone} live={isLive} />
      ) : loading ? (
        <span aria-hidden className="h-4 w-12 shrink-0 animate-pulse rounded-full bg-muted" />
      ) : null}
      {offline ? (
        <CloudOff aria-label="Showing the last saved copy" className="size-3.5 shrink-0 text-fg-muted" />
      ) : null}
      {href ? (
        <ArrowUpRight
          aria-hidden
          className="size-3.5 shrink-0 text-icon opacity-0 transition-opacity group-hover/chip:opacity-100 group-focus-visible/chip:opacity-100"
        />
      ) : null}
    </>
  );
  const shell = cn(
    'group/chip inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border-subtle bg-panel text-left',
    size === 'sm' ? 'h-7 px-1.5 text-xs' : 'h-8 px-2 text-sm',
    className,
  );
  return (
    <Tooltip content={tip}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            shell,
            'hover:border-border-default hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          )}
          data-testid="record-chip"
          data-state={live?.state ?? 'stored'}
        >
          {body}
          <span className="sr-only">
            {' '}
            ({TARGET_WORDS[type]} in {SIBLING_APP_NAMES[app]}, opens in a new tab)
          </span>
        </a>
      ) : (
        <span className={shell} tabIndex={0} data-testid="record-chip" data-state={live?.state ?? 'stored'}>
          {body}
        </span>
      )}
    </Tooltip>
  );
}
