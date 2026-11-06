'use client';
/**
 * Template detail preview: every group of the board with 3-4 realistic rows, every template
 * column at a sensible fixed width (horizontal scroll), owner avatars, money, dates and linked
 * records. Status pills can be clicked to try the board.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Link2, Plus, Star } from 'lucide-react';
import { Avatar, AvatarGroup, cn, labelColorStyle, toLabelColor } from '@/components/ui';
import type { GalleryBoard, GalleryColumn, GalleryLabel } from '@/server/services/wizards-gallery';
import { addItemLabel } from '../model/board-setup';
import { buildPreviewGroups, previewColumnWidth, type PreviewLinks, type PreviewPeople } from '../model/preview-data';

export { TemplateThumbnail } from './template-thumbnail';

function labelFor(column: GalleryColumn, value: unknown): GalleryLabel | null {
  if (!value || typeof value !== 'object') return null;
  const id = (value as { labelId?: unknown }).labelId;
  return column.labels?.find((label) => label.id === id) ?? null;
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();
function formatMoney(amount: number, currency: string): string {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
    } catch {
      formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
    }
    currencyFormatters.set(currency, formatter);
  }
  return formatter.format(amount);
}

function formatShortDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function PreviewCell({
  column,
  value,
  onCycle,
}: {
  readonly column: GalleryColumn;
  readonly value: unknown;
  readonly onCycle: () => void;
}) {
  const muted = <span className="text-fg-muted">—</span>;
  switch (column.type) {
    case 'status': {
      const label = labelFor(column, value);
      return (
        <button
          type="button"
          onClick={onCycle}
          title="Click to try a different label"
          aria-label={`${column.title}: ${label?.name ?? 'empty'}. Click to change`}
          className={cn(
            'absolute inset-[3px] flex items-center justify-center truncate rounded-[3px] px-2 text-sm font-medium transition-[background-color,transform] duration-[var(--duration-fast)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
            label ? 'bg-[var(--lc-bg)] text-[var(--lc-fg)] hover:bg-[var(--lc-hover)]' : 'bg-muted text-fg-muted hover:bg-hover',
          )}
          style={label ? labelColorStyle(label.color) : undefined}
        >
          <span className="truncate">{label?.name ?? ''}</span>
        </button>
      );
    }
    case 'dropdown': {
      const ids = (value as { labelIds?: string[] } | undefined)?.labelIds ?? [];
      const labels = ids.map((id) => column.labels?.find((label) => label.id === id)).filter(Boolean) as GalleryLabel[];
      if (!labels.length) return muted;
      return (
        <span className="flex gap-1 overflow-hidden">
          {labels.map((label) => (
            <span
              key={label.id}
              className="truncate rounded-full bg-[var(--lc-subtle)] px-2 text-xs leading-5 text-fg"
              style={labelColorStyle(label.color)}
            >
              {label.name}
            </span>
          ))}
        </span>
      );
    }
    case 'currency': {
      const money = value as { amount?: number; currency?: string } | undefined;
      if (typeof money?.amount !== 'number') return muted;
      return <span className="tabular-nums">{formatMoney(money.amount, money.currency ?? column.currency ?? 'USD')}</span>;
    }
    case 'number':
      return typeof value === 'number' ? (
        <span className="tabular-nums">
          {value.toLocaleString('en-US')}
          {column.unit ?? ''}
        </span>
      ) : (
        muted
      );
    case 'date': {
      const text = formatShortDate((value as { date?: string } | undefined)?.date);
      return text ? <span>{text}</span> : muted;
    }
    case 'timeline': {
      const range = value as { from?: string; to?: string } | undefined;
      const from = formatShortDate(range?.from);
      const to = formatShortDate(range?.to);
      if (!from || !to) return muted;
      return (
        <span className="inline-flex h-5 items-center rounded-full bg-primary px-2 text-xs font-medium text-primary-fg">
          {from === to ? from : `${from} – ${to}`}
        </span>
      );
    }
    case 'people': {
      const names = (value as Partial<PreviewPeople> | undefined)?.previewPeople ?? [];
      if (!names.length) return muted;
      return names.length === 1 ? (
        <Avatar name={names[0]!} size="xs" showTooltip />
      ) : (
        <AvatarGroup size="xs" people={names.map((name) => ({ id: name, name }))} />
      );
    }
    case 'connect_boards': {
      const links = (value as Partial<PreviewLinks> | undefined)?.previewLinks ?? [];
      if (!links.length) return muted;
      return (
        <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-border-subtle bg-sunken px-2 text-xs leading-5 text-fg">
          <Link2 aria-hidden className="size-3 shrink-0 text-icon" />
          <span className="truncate">{links[0]}</span>
        </span>
      );
    }
    case 'formula': {
      const money = value as { amount?: number; currency?: string } | undefined;
      return typeof money?.amount === 'number' ? (
        <span className="text-fg-secondary tabular-nums">{formatMoney(money.amount, money.currency ?? 'USD')}</span>
      ) : (
        muted
      );
    }
    case 'phone': {
      const phone = (value as { phone?: string } | undefined)?.phone;
      return phone ? <span className="truncate tabular-nums">{phone}</span> : muted;
    }
    case 'link': {
      const link = value as { url?: string; text?: string } | undefined;
      return link?.url ? <span className="truncate text-fg-link">{link.text ?? link.url}</span> : muted;
    }
    case 'tags': {
      const tags = (value as { tags?: string[] } | undefined)?.tags ?? [];
      return tags.length ? (
        <span className="flex gap-1 overflow-hidden">
          {tags.map((tag) => (
            <span key={tag} className="truncate rounded-sm bg-muted px-1.5 text-xs leading-5 text-fg">
              #{tag}
            </span>
          ))}
        </span>
      ) : (
        muted
      );
    }
    case 'country': {
      const code = (value as { code?: string } | undefined)?.code;
      return code ? <span>{code}</span> : muted;
    }
    case 'location': {
      const address = (value as { address?: string } | undefined)?.address;
      return address ? <span className="truncate">{address}</span> : muted;
    }
    case 'checkbox':
      return value === true ? (
        <Check aria-label="Checked" className="size-4 text-success" />
      ) : (
        <span aria-label="Not checked" className="inline-block size-4 rounded-xs border border-border-strong" />
      );
    case 'rating': {
      const stars = typeof value === 'number' ? value : 0;
      return (
        <span className="flex" aria-label={`${stars} of 5`}>
          {Array.from({ length: 5 }, (_, index) => (
            <Star
              key={index}
              aria-hidden
              className={cn('size-3.5', index < stars ? 'fill-[var(--warning-accent)] text-[var(--warning-accent)]' : 'text-border-strong')}
            />
          ))}
        </span>
      );
    }
    case 'text':
    case 'long_text':
      return typeof value === 'string' && value ? <span className="truncate">{value}</span> : muted;
    case 'email':
      return typeof (value as { email?: string } | undefined)?.email === 'string' ? (
        <span className="truncate text-fg-link">{(value as { email: string }).email}</span>
      ) : (
        muted
      );
    default:
      return muted;
  }
}

/** Interactive preview of one board: every group with realistic rows and every column. */
export function BoardPreview({ board, terminology }: { readonly board: GalleryBoard; readonly terminology?: string }) {
  const columns = useMemo(() => board.columns.filter((column) => column.type !== 'name'), [board]);
  const groups = useMemo(() => buildPreviewGroups(board, { perGroup: 3 }), [board]);
  const nameColumn = board.columns.find((column) => column.type === 'name');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const term = terminology || board.itemTerminology;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState(false);
  const measureFade = useCallback(() => {
    const node = scrollRef.current;
    if (node) setFade(node.scrollWidth - node.scrollLeft - node.clientWidth > 4);
  }, []);
  useEffect(() => {
    measureFade();
    const node = scrollRef.current;
    if (!node) return;
    const observer = new ResizeObserver(measureFade);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measureFade, board]);

  const cycle = (rowKey: string, column: GalleryColumn, current: unknown) => {
    const labels = column.labels ?? [];
    if (!labels.length) return;
    const currentId = overrides[`${rowKey}:${column.key}`] ?? (current as { labelId?: string } | undefined)?.labelId;
    const index = labels.findIndex((label) => label.id === currentId);
    const next = labels[(index + 1) % labels.length];
    if (next) setOverrides((map) => ({ ...map, [`${rowKey}:${column.key}`]: next.id }));
  };

  const nameWidth = previewColumnWidth({ type: 'name' });
  const template = [`${nameWidth}px`, ...columns.map((column) => `${previewColumnWidth(column)}px`)].join(' ');
  const totalWidth = nameWidth + columns.reduce((sum, column) => sum + previewColumnWidth(column), 0) + 6;
  return (
    <div className="relative min-w-0">
    <div
      ref={scrollRef}
      onScroll={measureFade}
      className="min-w-0 overflow-x-auto rounded-md [scrollbar-width:thin]"
      data-testid="template-preview-board"
    >
      <div className="flex flex-col gap-6 pb-2" style={{ width: totalWidth }}>
        {groups.map(({ group, rows }) => {
          const color = toLabelColor(group.color);
          return (
            <section key={group.key} aria-label={group.title}>
              <h4
                className="sticky left-0 mb-1.5 inline-flex items-center gap-2 font-heading text-md font-semibold"
                style={{ color: `var(--label-${color}-text)` }}
                data-testid="preview-group-title"
              >
                {group.title}
                <span className="text-sm font-normal text-fg-muted tabular-nums">{rows.length}</span>
              </h4>
              <div
                role="table"
                aria-label={`${group.title} preview`}
                className="overflow-clip rounded-md border border-border-subtle bg-raised shadow-xs"
                style={{ borderLeft: `6px solid var(--label-${color})` }}
              >
                <div role="row" className="grid border-b border-border-subtle text-sm text-fg-secondary" style={{ gridTemplateColumns: template }}>
                  <span role="columnheader" className="sticky left-0 z-[1] truncate bg-raised px-3 py-1.5 font-medium shadow-[1px_0_0_var(--border-subtle)]">
                    {nameColumn?.title ?? term}
                  </span>
                  {columns.map((column) => (
                    <span
                      key={column.key}
                      role="columnheader"
                      title={column.title}
                      className="truncate border-l border-border-subtle px-2 py-1.5 text-center"
                    >
                      {headerLabel(column)}
                    </span>
                  ))}
                </div>
                {rows.map((row) => (
                  <div
                    key={row.key}
                    role="row"
                    data-testid="preview-row"
                    className="group/row grid h-9 border-b border-border-subtle text-base text-fg transition-colors duration-[var(--duration-instant)] hover:bg-hover"
                    style={{ gridTemplateColumns: template }}
                  >
                    <span
                      role="cell"
                      className="sticky left-0 z-[1] flex items-center truncate bg-raised px-3 shadow-[1px_0_0_var(--border-subtle)] group-hover/row:bg-[color-mix(in_srgb,var(--surface-raised),var(--icon-default)_9%)]"
                    >
                      <span className="truncate">{row.name}</span>
                    </span>
                    {columns.map((column) => {
                      const override = overrides[`${row.key}:${column.key}`];
                      const value = override ? { labelId: override } : row.values[column.key];
                      return (
                        <span
                          key={column.key}
                          role="cell"
                          className="relative flex items-center justify-center overflow-hidden border-l border-border-subtle px-2 text-sm"
                        >
                          <PreviewCell column={column} value={value} onCycle={() => cycle(row.key, column, row.values[column.key])} />
                        </span>
                      );
                    })}
                  </div>
                ))}
                <div className="flex h-9 items-center gap-1.5 px-3 text-sm text-fg-muted">
                  <Plus aria-hidden className="size-3.5" />
                  {addItemLabel(term)}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
      <div
        aria-hidden
        data-testid="template-preview-fade"
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-md bg-gradient-to-l from-[var(--surface-sunken)] to-transparent transition-opacity duration-[var(--duration-fast)] ease-out',
          fade ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}

/** Short header for long titles ("Close probability" → "Probability"); the full title is the tooltip. */
function headerLabel(column: GalleryColumn): string {
  if (column.type === 'number' && /probab/i.test(column.title) && column.title.length > 11) return 'Probability';
  return column.title;
}
