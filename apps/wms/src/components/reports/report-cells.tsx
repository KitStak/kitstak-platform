'use client';

/**
 * Column factory for the report shell: turns a pure `ReportColumn` spec into a
 * TanStack column with the right cell (links, pills, money, dates, difference pills).
 */
import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DateCell, LinkCell, MoneyCell, QtyCell, YesNoPill } from '@/components/grid';
import { StatusPill } from '@/components/ui/status-pill';
import { differenceTone, pillStyle, TONES, type StatusTone } from '@/lib/status-colors';
import { useFormat } from '@/lib/format';
import type { ReportColumn } from '@/lib/grid-defs/reports/types';

export type ReportRow = Readonly<Record<string, unknown>>;

const LOCAL_TONES: Readonly<Record<string, StatusTone>> = {
  create: TONES.green,
  update: TONES.blue,
  delete: TONES.red,
  stock: TONES.green,
  allocated: TONES.blue,
  picked: TONES.readyBlue,
  sorted: TONES.indigo,
  packed: TONES.purple,
  loaded: TONES.purple,
  received: TONES.green,
  shipped: TONES.teal,
  updated: TONES.blue,
  'receipt cancelled': TONES.red,
  'shipment order cancelled': TONES.red,
  // Order Line Progress line states.
  'picked, not packed': TONES.readyBlue,
  'not picked': TONES.amber,
};

const Empty = () => <span className="text-faint">None</span>;

export function ReportPill({
  status,
  domain,
}: {
  readonly status: string;
  readonly domain?: ReportColumn['pill'];
}) {
  if (domain) return <StatusPill status={status} domain={domain} />;
  const tone = LOCAL_TONES[status.toLowerCase()];
  if (!tone) return <StatusPill status={status} />;
  return (
    <span
      data-status={status}
      style={pillStyle(tone)}
      className="inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold leading-4 whitespace-nowrap"
    >
      {status}
    </span>
  );
}

/** Receiving difference pill (spec 07): negative red, positive green, blank at zero. */
export function DiffPill({ value }: { readonly value: number | null | undefined }) {
  const fmt = useFormat();
  if (value === null || value === undefined || value === 0) return <span className="text-faint">None</span>;
  const tone = differenceTone(value);
  return (
    <span
      data-diff={value < 0 ? 'negative' : 'positive'}
      style={pillStyle(tone)}
      className="inline-flex rounded-[5px] px-1.5 py-0.5 text-2xs font-bold tabular-nums"
    >
      {value > 0 ? '+' : ''}
      {fmt.quantity(value)}
    </span>
  );
}

function Initials({ name }: { readonly name: string }) {
  const parts = name
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  const ini = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-2xs font-bold text-primary"
    >
      {ini}
    </span>
  );
}

function renderValue(c: ReportColumn, row: ReportRow): React.ReactNode {
  const v = row[c.id];
  switch (c.kind) {
    case 'number':
      return (
        <span className="block text-right">
          <QtyCell value={typeof v === 'number' ? v : null} muteZero />
        </span>
      );
    case 'decimal':
      return typeof v === 'number' ? (
        <span className="block text-right tabular-nums">
          {v.toLocaleString('en-US', { maximumFractionDigits: 2 })}
        </span>
      ) : (
        <Empty />
      );
    case 'money':
      return <MoneyCell value={typeof v === 'number' ? v : null} />;
    case 'datetime':
      return <DateCell value={typeof v === 'string' ? v : null} />;
    case 'date':
      return <DateCell value={typeof v === 'string' ? v : null} dateOnly />;
    case 'pill':
      return typeof v === 'string' && v ? <ReportPill status={v} domain={c.pill} /> : <Empty />;
    case 'diff':
      return (
        <span className="block text-right">
          <DiffPill value={typeof v === 'number' ? v : null} />
        </span>
      );
    case 'yesNo':
      return <YesNoPill value={Boolean(v)} />;
    case 'user': {
      // `<id>Detail` (e.g. the email behind a display name) is shown on hover.
      const detail = row[`${c.id}Detail`];
      const tip =
        typeof detail === 'string' && detail && detail !== v ? `${String(v)} (${detail})` : String(v ?? '');
      return typeof v === 'string' && v ? (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Initials name={v} />
          <span className="truncate" title={tip}>
            {v}
          </span>
        </span>
      ) : (
        <Empty />
      );
    }
    default:
      if (v === null || v === undefined || v === '') return <Empty />;
      if (c.kind === 'strong') {
        return typeof v === 'number' ? (
          <span className="block text-right font-semibold tabular-nums">{v.toLocaleString('en-US')}</span>
        ) : (
          <span className="block truncate font-semibold" title={String(v)}>
            {String(v)}
          </span>
        );
      }
      // Free-text values that are ISO timestamps (Change Log "Cancelled At" from/to) read as dates, never raw ISO.
      if (typeof v === 'string' && ISO_DATETIME_RE.test(v)) return <DateCell value={v} />;
      // Dates written as text by other modules ("11/10/2026 01:37 PM EST") wrap, never ellipsize.
      if (typeof v === 'string' && DATE_TEXT_RE.test(v))
        return (
          <span className="block whitespace-normal break-words text-xs leading-[1.25] tabular-nums" title={v}>
            {v}
          </span>
        );
      return (
        <span
          className={c.kind === 'mono' ? 'block truncate font-mono text-xs' : 'block truncate'}
          title={String(v)}
        >
          {String(v)}
        </span>
      );
  }
}

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** A formatted date or date-time held as text (`11/10/2026 01:37 PM EST`, `2026-11-10 13:37`). */
export const DATE_TEXT_RE =
  /^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}[/.-]\d{1,2}[/.-]\d{1,2})([ T]\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?(\s[A-Z]{2,5})?)?$/;

/**
 * Smallest width at which a date column shows its whole value ("11/10/2026 12:40 PM", or a
 * 24 h time with seconds) plus the cell padding. Dates are never ellipsized.
 */
export const DATETIME_MIN_WIDTH = 196;
export const DATE_MIN_WIDTH = 116;

export function reportColumnWidth(c: Pick<ReportColumn, 'kind' | 'width'>): {
  readonly size: number;
  readonly minSize: number;
} {
  const min = c.kind === 'datetime' ? DATETIME_MIN_WIDTH : c.kind === 'date' ? DATE_MIN_WIDTH : 60;
  return { size: Math.max(c.width ?? 140, min), minSize: min };
}

const RIGHT_KINDS = new Set(['number', 'decimal', 'money', 'diff']);

/**
 * Room left for the header text: column width − cell padding (24) − sort icon + gap (16) −
 * drag grip (12) − info icon (18 when the column has a tip). Never below 40 px.
 */
export function headerLabelWidth(width: number, hasTip: boolean): number {
  return Math.max(40, Math.floor(width - 52 - (hasTip ? 18 : 0)));
}

/**
 * Widest rendered line of a wrapped label. A two-line label's box is as wide as its max
 * width, not its text, so the header's (i) icon would float away from the words; the
 * label is shrink-wrapped to this width so the icon sits right next to its own text.
 */
export function widestLineWidth(rects: ArrayLike<{ readonly width: number }>): number {
  let max = 0;
  for (let i = 0; i < rects.length; i += 1) max = Math.max(max, rects[i]?.width ?? 0);
  return Math.ceil(max);
}

function HeaderLabel({
  label,
  width,
  hasTip,
  right,
}: {
  readonly label: string;
  readonly width: number;
  readonly hasTip: boolean;
  readonly right: boolean;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const maxWidth = headerLabelWidth(width, hasTip);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !hasTip || typeof document === 'undefined') return;
    const fit = () => {
      el.style.width = '';
      const range = document.createRange();
      range.selectNodeContents(el);
      const w = widestLineWidth(range.getClientRects());
      if (w > 0 && w < el.getBoundingClientRect().width - 1) el.style.width = `${w}px`;
    };
    fit();
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) fit();
    });
    return () => {
      live = false;
    };
  }, [label, maxWidth, hasTip]);
  return (
    <span
      ref={ref}
      title={label}
      className={`line-clamp-2 w-fit whitespace-normal break-normal leading-[1.3] ${right ? 'text-right' : 'text-left'}`}
      style={{ maxWidth }}
    >
      {label}
    </span>
  );
}

export function buildReportColumns(
  columns: readonly ReportColumn[],
  overrides: Readonly<Record<string, (row: ReportRow) => React.ReactNode>> = {},
): ColumnDef<ReportRow, unknown>[] {
  return columns.map((c) => ({
    id: c.id,
    accessorFn: (row) => row[c.id],
    // Long uppercase labels wrap to two lines inside the column (then clamp with a tooltip),
    // so they never run under the next column's header or its info icon.
    header: ({ column }) => (
      <HeaderLabel
        label={c.label}
        width={column.getSize()}
        hasTip={Boolean(c.tip)}
        right={RIGHT_KINDS.has(c.kind ?? '')}
      />
    ),
    // Date columns never shrink below their full value (saved widths are clamped by minSize).
    ...reportColumnWidth(c),
    enableSorting: c.sortable !== false,
    meta: {
      label: c.label,
      ...(c.tip ? { headerTip: c.tip } : {}),
      ...(c.alwaysVisible ? { alwaysVisible: true } : {}),
      ...(c.defaultHidden ? { defaultVisible: false } : {}),
      ...(RIGHT_KINDS.has(c.kind ?? '') || (c.kind === 'strong' && c.exportType === 'integer')
        ? { align: 'right' as const }
        : {}),
      ...(c.kind === 'pill' || c.kind === 'diff' || c.kind === 'yesNo' ? { clip: false } : {}),
    },
    cell: ({ row }) => {
      const custom = overrides[c.id];
      if (custom) return custom(row.original);
      const content = renderValue(c, row.original);
      const href = c.hrefKey ? row.original[c.hrefKey] : null;
      return typeof href === 'string' && href ? (
        <LinkCell href={href} className="block min-w-0 truncate">
          {content}
        </LinkCell>
      ) : (
        content
      );
    },
  }));
}

/** Id of the sticky-right gutter that sits under the floating column chooser. */
export const CHOOSER_GUTTER_ID = 'chooserGutter';
/** Chooser button (28) + its inset (4) + edge shadow (8) + a vertical scrollbar's width. */
export const CHOOSER_GUTTER_WIDTH = 48;

/**
 * Empty sticky-right column reserved for the DataGrid's floating column chooser (it is
 * absolutely positioned over the header's right end). Without it the chooser covers the
 * right-most visible header label and intercepts clicks on its sort button.
 */
export function chooserGutterColumn(): ColumnDef<ReportRow, unknown> {
  return {
    id: CHOOSER_GUTTER_ID,
    size: CHOOSER_GUTTER_WIDTH,
    minSize: CHOOSER_GUTTER_WIDTH,
    maxSize: CHOOSER_GUTTER_WIDTH,
    enableSorting: false,
    enableResizing: false,
    enableHiding: false,
    header: () => <span className="sr-only">Column options</span>,
    cell: () => null,
    meta: { label: 'Column options (fixed)', alwaysVisible: true, sticky: 'right', clip: false },
  };
}
