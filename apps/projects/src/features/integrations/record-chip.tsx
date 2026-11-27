'use client';
/**
 * Compact chip for a linked CRM / WMS record: the sibling app's brand mark, the record title and
 * its live status (colour from the status meaning: won/shipped green, lost/cancelled red…).
 * Opens the record in its app in a new tab; optional remove button.
 *
 *   <RecordChip link={link} />                          // from an IntegrationLinkDTO
 *   <RecordChip target={{ type, title, status, url }} size="sm" onRemove={…} />
 */
import type { ReactNode } from 'react';
import { ArrowUpRight, Boxes, Briefcase, FolderKanban, Repeat2, X } from 'lucide-react';
import { StatusPill, Tooltip, cn } from '@/components/ui';
import { INTEGRATION_TARGET_LABELS, type IntegrationTargetType } from '@/lib/constants';
import type { IntegrationLinkDTO } from '@/lib/types';
import type { LinkedRecordDTO } from '@/lib/program-types';
import { TONE_COLOR, statusTone, targetApp } from './status-tone';
import { RecordHoverCard } from './record-hover-card';
import { liveProgramUrl } from '@/features/programs/kit/live-pages';

const MARKS: Readonly<
  Record<'crm' | 'wms', readonly (readonly [number, number, number, number, boolean?])[]>
> = {
  crm: [
    [36, 50, 128, 26],
    [56, 87, 88, 26, true],
    [76, 124, 48, 26],
  ],
  wms: [
    [46, 54, 30, 28, true],
    [86, 62, 26, 20, true],
    [122, 50, 32, 32, true],
    [34, 82, 132, 14],
    [44, 110, 36, 26, true],
    [90, 116, 28, 20, true],
    [128, 106, 26, 30, true],
    [34, 136, 132, 14],
  ],
};

/** The CRM or WMS app mark from the brand pack (inline so it renders on any origin). */
export function SiblingAppMark({
  app,
  size = 16,
  className,
}: {
  readonly app: 'crm' | 'wms';
  readonly size?: number;
  readonly className?: string;
}) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="28 40 144 120" className={className}>
      {MARKS[app].map(([x, y, w, h, pink]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} fill={pink ? '#D65A6E' : '#C8102E'} />
      ))}
    </svg>
  );
}

export interface RecordChipTarget {
  readonly type: IntegrationTargetType;
  readonly title: string | null;
  readonly status: string | null;
  readonly url: string | null;
}

/** Status of a linked record, coloured by meaning. */
export function RecordStatus({
  status,
  className,
}: {
  readonly status: string | null | undefined;
  readonly className?: string;
}) {
  if (!status) return null;
  return (
    <StatusPill label={statusLabel(status)} color={TONE_COLOR[statusTone(status)]} className={cn('shrink-0', className)} />
  );
}

/** Cached statuses come in as stored ("active", "in_progress"); show them as words ("Active", "In progress"). */
export function statusLabel(status: string): string {
  const text = status.trim();
  if (text === '' || /[A-Z]/.test(text)) return text;
  const words = text.replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function RecordChip({
  link,
  target,
  size = 'md',
  onRemove,
  className,
  trailing,
}: {
  readonly link?: IntegrationLinkDTO;
  readonly target?: RecordChipTarget;
  readonly size?: 'sm' | 'md';
  readonly onRemove?: () => void;
  readonly className?: string;
  readonly trailing?: ReactNode;
}) {
  const record: RecordChipTarget | null =
    target ??
    (link ? { type: link.targetType, title: link.title, status: link.status, url: link.url } : null);
  if (!record) return null;
  // Program pages land in later layers; until one exists the chip does not link (live-pages.ts).
  const url = liveProgramUrl(record.url);
  const label = INTEGRATION_TARGET_LABELS[record.type];
  const title = record.title ?? label;
  const app = targetApp(record.type);
  const body = (
    <>
      <SiblingAppMark app={app} size={size === 'sm' ? 12 : 14} className="shrink-0" />
      <span className="min-w-0 truncate font-medium text-fg">{title}</span>
      {size === 'md' ? <RecordStatus status={record.status} /> : null}
      {url ? (
        <ArrowUpRight
          aria-hidden
          className="size-3.5 shrink-0 text-icon opacity-0 transition-opacity group-hover/chip:opacity-100"
        />
      ) : null}
    </>
  );
  const shell = cn(
    'group/chip inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border-subtle bg-panel text-left',
    size === 'sm' ? 'h-6 px-1.5 text-xs' : 'h-8 px-2 text-sm',
    className,
  );
  const tooltip = `${label}${record.status ? ` · ${record.status}` : ''}${url ? ' · opens in a new tab' : ''}`;
  const anchor = url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        shell,
        'transition-colors hover:border-border-default hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
      )}
    >
      {body}
    </a>
  ) : (
    <span className={shell} tabIndex={0}>
      {body}
    </span>
  );
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-0.5" data-testid="record-chip">
      {link && link.targetType !== 'core_customer' ? (
        <RecordHoverCard type={link.targetType} id={link.targetId}>
          {anchor}
        </RecordHoverCard>
      ) : (
        <Tooltip content={tooltip}>{anchor}</Tooltip>
      )}
      {trailing}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Unlink ${title}`}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-icon hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </span>
  );
}

const LINKED_TYPE_LABELS: Readonly<Record<LinkedRecordDTO['type'], string>> = {
  core_customer: 'Customer',
  core_item: 'Item',
  crm_deal: 'CRM deal',
  crm_account: 'CRM account',
  pm_project: 'Project',
  pm_program: 'Program',
  pm_task: 'Task',
  pm_build: 'Build',
  pm_variant: 'Variant',
  pulse_job: 'Pulse job',
  wms_work_order: 'WMS work order',
  wms_shipment_order: 'WMS shipment order',
  wms_client: 'WMS client',
  wms_product: 'WMS product',
};

const RELATION_LABELS: Readonly<Record<LinkedRecordDTO['relation'], string>> = {
  related: 'Related',
  belongs_to: 'Belongs to',
  bills_to: 'Bills to',
  uses_kit: 'Uses kit',
  created_from: 'Made from',
};

/** The mark for a linked record's app: the CRM or WMS brand mark, or a glyph for Pulse and Projects records. */
export function LinkedRecordMark({ record, size = 14 }: { readonly record: Pick<LinkedRecordDTO, 'type' | 'app'>; readonly size?: number }) {
  if (record.app === 'crm' || record.app === 'core') return <SiblingAppMark app="crm" size={size} className="shrink-0" />;
  if (record.app === 'wms') return <SiblingAppMark app="wms" size={size} className="shrink-0" />;
  const Icon = record.type === 'pulse_job' ? Briefcase : record.type === 'pm_program' ? Repeat2 : record.type === 'pm_build' || record.type === 'pm_variant' ? Boxes : FolderKanban;
  return <Icon aria-hidden className="shrink-0 text-icon" style={{ width: size, height: size }} />;
}

export interface LinkedRecordChipProps {
  readonly record: LinkedRecordDTO;
  readonly size?: 'sm' | 'md';
  /** Show the relation ("Bills to", "Related"). */
  readonly showRelation?: boolean;
  readonly onRemove?: () => void;
  readonly className?: string;
}

/**
 * A record from the link graph (`core.record_links`, legacy project links and Pulse job links):
 * app mark, title, status, and the relation. Money links ("Bills to") are tinted. A dangling link
 * says "This record is no longer available" and keeps its Remove button.
 */
export function LinkedRecordChip({ record, size = 'md', showRelation = true, onRemove, className }: LinkedRecordChipProps) {
  const label = LINKED_TYPE_LABELS[record.type];
  const url = liveProgramUrl(record.url);
  const shell = cn(
    'group/chip inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border bg-panel text-left',
    record.moneyEdge ? 'border-success/40' : 'border-border-subtle',
    size === 'sm' ? 'h-6 px-1.5 text-xs' : 'h-8 px-2 text-sm',
    className,
  );
  const body = record.dangling ? (
    <>
      <LinkedRecordMark record={record} size={size === 'sm' ? 12 : 14} />
      <span className="min-w-0 truncate text-fg-muted italic">This record is no longer available</span>
    </>
  ) : (
    <>
      <LinkedRecordMark record={record} size={size === 'sm' ? 12 : 14} />
      <span className="min-w-0 truncate font-medium text-fg">{record.title}</span>
      {size === 'md' ? <RecordStatus status={record.status} /> : null}
      {showRelation && record.relation !== 'related' ? (
        <span className={cn('shrink-0 rounded-sm px-1 text-2xs font-semibold', record.moneyEdge ? 'bg-success-subtle text-success-text' : 'bg-muted text-fg-secondary')}>{RELATION_LABELS[record.relation]}</span>
      ) : null}
      {url ? <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-icon opacity-0 transition-opacity group-hover/chip:opacity-100" /> : null}
    </>
  );
  const tooltip = `${label}${record.status ? ` · ${record.status}` : ''} · ${RELATION_LABELS[record.relation]}${url && !record.dangling ? ' · opens the record' : ''}`;
  const internal = record.app === 'projects';
  const anchor =
    url && !record.dangling ? (
      <a href={url} target={internal ? undefined : '_blank'} rel={internal ? undefined : 'noopener noreferrer'} className={cn(shell, 'transition-colors hover:border-border-default hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus')}>
        {body}
      </a>
    ) : (
      <span className={shell} tabIndex={0}>
        {body}
      </span>
    );
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-0.5" data-testid="linked-record-chip" data-type={record.type} data-relation={record.relation}>
      <Tooltip content={tooltip}>{anchor}</Tooltip>
      {onRemove && record.removable ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove the link to ${record.dangling ? 'this record' : record.title}`}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-icon hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </span>
  );
}
