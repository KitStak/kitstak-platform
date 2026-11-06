'use client';
/**
 * Gallery card thumbnail: a real micro-board (tinted icon + board name, column headers, group
 * titles in their colour, item names and status pills with label text). Composition follows
 * what the template is for: kanban strip for pipelines, timeline bars for projects, a mini
 * calendar for date-driven boards, a form for intake, a table otherwise.
 */
import { useMemo, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { labelColorStyle, toLabelColor } from '@/components/ui';
import type { GalleryBoard, GalleryColumn, GalleryLabel } from '@/server/services/wizards-gallery';
import { buildPreviewGroups, thumbnailLayout, viewForLayout, type PreviewGroup, type PreviewRow } from '../model/preview-data';

/** Fixed clock so thumbnails render identically on server and client. */
const THUMB_NOW = Date.UTC(2026, 0, 12);

export interface TemplateThumbnailProps {
  readonly board: GalleryBoard;
  readonly accent: string;
  readonly icon: ReactNode;
  /** Solution entries: every board of the suite, drawn as connected tiles plus a dashboard. */
  readonly suite?: readonly GalleryBoard[];
  /** Header label (defaults to the board name; solutions pass their own name). */
  readonly title?: string;
}

function labelOf(column: GalleryColumn | undefined, row: PreviewRow): GalleryLabel | null {
  if (!column) return null;
  const id = (row.values[column.key] as { labelId?: string } | undefined)?.labelId;
  return column.labels?.find((label) => label.id === id) ?? null;
}

function Pill({ label }: { readonly label: GalleryLabel | null }) {
  if (!label) return <span className="block h-full rounded-[2px] bg-muted" />;
  return (
    <span
      className="flex h-full items-center justify-center truncate rounded-[2px] bg-[var(--lc-bg)] px-1 text-[9px] leading-none font-medium text-[var(--lc-fg)]"
      style={labelColorStyle(label.color)}
    >
      <span className="truncate">{label.name}</span>
    </span>
  );
}

function groupText(color: string) {
  return { color: `var(--label-${toLabelColor(color)}-text)` };
}

function TableBody({ board, groups }: { readonly board: GalleryBoard; readonly groups: readonly PreviewGroup[] }) {
  const pills = board.columns.filter((column) => column.type === 'status').slice(0, 2);
  const term = board.columns.find((column) => column.type === 'name')?.title ?? board.itemTerminology;
  const grid = { gridTemplateColumns: `minmax(0,1fr) ${pills.map(() => '58px').join(' ')}` };
  const shown = [
    { ...groups[0], rows: groups[0]?.rows.slice(0, 2) ?? [] },
    { ...groups[1], rows: groups[1]?.rows.slice(0, 1) ?? [] },
  ].filter((item) => item.group);
  return (
    <div className="flex flex-col gap-1 px-2 pt-1 pb-2">
      <div className="grid gap-[3px] text-[9px] leading-[12px] text-fg-muted" style={grid}>
        <span className="truncate pl-[7px]">{term}</span>
        {pills.map((column) => (
          <span key={column.key} className="truncate text-center">
            {column.title}
          </span>
        ))}
      </div>
      {shown.map(({ group, rows }) => (
        <div key={group!.key} className="flex flex-col gap-[3px]">
          <span className="truncate text-[10px] leading-[13px] font-semibold" style={groupText(group!.color)}>
            {group!.title}
          </span>
          {rows.map((row) => (
            <div
              key={row.key}
              className="grid h-[17px] gap-[3px] overflow-hidden rounded-[3px] bg-sunken"
              style={{ ...grid, boxShadow: `inset 3px 0 0 var(--label-${toLabelColor(group!.color)})` }}
            >
              <span className="truncate self-center pl-[7px] text-[10px] leading-none text-fg">{row.name}</span>
              {pills.map((column) => (
                <span key={column.key} className="py-[2px] pr-[2px]">
                  <Pill label={labelOf(column, row)} />
                </span>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function KanbanBody({ board, groups }: { readonly board: GalleryBoard; readonly groups: readonly PreviewGroup[] }) {
  const status = board.columns.find((column) => column.type === 'status');
  const rows = groups.flatMap((item) => item.rows);
  const stages = (status?.labels ?? []).slice(0, 3);
  const money = board.columns.find((column) => column.type === 'currency');
  // Each row appears once: in its own stage, or (when its stage isn't shown) topping up an empty one.
  const stageIds = new Set(stages.map((stage) => stage.id));
  const leftovers = rows.filter((row) => !stageIds.has(labelOf(status, row)?.id ?? ''));
  const columns = stages.map((stage) => {
    const own = rows.filter((row) => labelOf(status, row)?.id === stage.id).slice(0, 2);
    return own.length ? own : leftovers.splice(0, stage === stages[0] ? 2 : 1);
  });
  return (
    <div className="grid grid-cols-3 gap-1.5 px-2 pt-1.5 pb-2">
      {stages.map((stage, stageIndex) => {
        const fill = columns[stageIndex] ?? [];
        return (
          <div key={stage.id} className="flex min-w-0 flex-col gap-1 rounded-[4px] bg-sunken p-1">
            <span
              className="truncate rounded-[2px] bg-[var(--lc-bg)] px-1 py-[2px] text-center text-[9px] leading-none font-semibold text-[var(--lc-fg)]"
              style={labelColorStyle(stage.color)}
            >
              {stage.name}
            </span>
            {fill.slice(0, 2).map((row) => {
              const amount = money ? (row.values[money.key] as { amount?: number } | undefined)?.amount : undefined;
              return (
                <span key={row.key} className="flex flex-col gap-[2px] rounded-[3px] border border-border-subtle bg-raised px-1 py-[3px] shadow-xs">
                  <span className="truncate text-[9.5px] leading-[11px] font-medium text-fg">{row.name}</span>
                  <span className="truncate text-[8.5px] leading-[10px] text-fg-muted tabular-nums">
                    {typeof amount === 'number' ? `$${Math.round(amount / 1000)}k` : board.itemTerminology}
                  </span>
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

const BAR_OFFSETS = ['4%', '22%', '12%', '38%'];
const BAR_WIDTHS = ['46%', '40%', '58%', '34%'];

function TimelineBody({ groups }: { readonly groups: readonly PreviewGroup[] }) {
  const rows = groups.flatMap((item) => item.rows.slice(0, 2).map((row) => ({ row, color: item.group.color }))).slice(0, 4);
  return (
    <div className="flex flex-col gap-[5px] px-2 pt-1.5 pb-2">
      <div className="ml-[38%] flex justify-between text-[8.5px] leading-none text-fg-muted">
        <span>Jan</span>
        <span>Feb</span>
        <span>Mar</span>
      </div>
      {rows.map(({ row, color }, index) => (
        <div key={row.key} className="flex h-[16px] items-center gap-1.5">
          <span className="w-[36%] shrink-0 truncate text-[10px] leading-none text-fg">{row.name}</span>
          <span className="relative h-full flex-1 rounded-[2px] bg-sunken">
            <span
              className="absolute top-[3px] bottom-[3px] rounded-full"
              style={{ left: BAR_OFFSETS[index], width: BAR_WIDTHS[index], background: `var(--label-${toLabelColor(color)})` }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

function CalendarBody({ groups }: { readonly groups: readonly PreviewGroup[] }) {
  const events = groups.flatMap((item) => item.rows.slice(0, 2).map((row) => ({ row, color: item.group.color })));
  const placed = new Map<number, (typeof events)[number]>([
    [1, events[0]!],
    [4, events[1]!],
    [8, events[2]!],
    [12, events[3]!],
  ]);
  return (
    <div className="grid grid-cols-7 gap-[2px] px-2 pt-1.5 pb-2">
      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
        <span key={`${day}-${index}`} className="text-center text-[8.5px] leading-[10px] text-fg-muted">
          {day}
        </span>
      ))}
      {Array.from({ length: 14 }, (_, index) => {
        const event = placed.get(index);
        return (
          <span key={index} className="flex h-[30px] min-w-0 flex-col gap-[2px] rounded-[2px] bg-sunken p-[2px]">
            <span className="text-[8px] leading-none text-fg-muted tabular-nums">{index + 5}</span>
            {event ? (
              <span
                className="truncate rounded-[2px] px-[2px] text-[8px] leading-[10px] font-medium text-[var(--lc-fg)]"
                style={{ ...labelColorStyle(toLabelColor(event.color)), background: 'var(--lc-bg)' }}
              >
                {event.row.name}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function FormBody({ board, groups }: { readonly board: GalleryBoard; readonly groups: readonly PreviewGroup[] }) {
  const fields = board.columns.filter((column) => column.type !== 'name' && column.type !== 'status').slice(0, 3);
  const rows = groups.flatMap((item) => item.rows).slice(0, 3);
  const status = board.columns.find((column) => column.type === 'status');
  return (
    <div className="grid grid-cols-[1.05fr_1fr] gap-2 px-2 pt-1.5 pb-2">
      <div className="flex flex-col gap-[4px] rounded-[4px] border border-border-subtle bg-sunken p-1.5">
        <span className="text-[10px] leading-none font-semibold text-fg">New {board.itemTerminology.toLowerCase()}</span>
        {fields.map((field) => (
          <span key={field.key} className="flex flex-col gap-[2px]">
            <span className="truncate text-[8.5px] leading-none text-fg-secondary">{field.title}</span>
            <span className="h-[9px] rounded-[2px] border border-border-default bg-raised" />
          </span>
        ))}
        <span className="mt-[1px] self-start rounded-[3px] bg-primary px-1.5 py-[2px] text-[8.5px] leading-none font-semibold text-primary-fg">
          Submit
        </span>
      </div>
      <div className="flex flex-col gap-[3px]">
        {rows.map((row) => (
          <span key={row.key} className="flex h-[24px] flex-col justify-center gap-[2px] rounded-[3px] bg-sunken px-1">
            <span className="truncate text-[9.5px] leading-none text-fg">{row.name}</span>
            <span className="h-[8px] w-3/5">
              <Pill label={labelOf(status, row)} />
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function BlankBody() {
  return (
    <div className="flex flex-col gap-[4px] px-2 pt-1.5 pb-2">
      {[0, 1, 2].map((row) => (
        <span key={row} className="grid h-[17px] grid-cols-[1fr_44px_44px] gap-[3px]">
          <span className="rounded-[3px] border border-dashed border-border-strong" />
          <span className="rounded-[3px] border border-dashed border-border-strong" />
          <span className="rounded-[3px] border border-dashed border-border-strong" />
        </span>
      ))}
      <span className="mt-0.5 flex items-center gap-1 text-[10px] leading-none font-medium text-fg-secondary">
        <Plus aria-hidden className="size-3 text-icon-strong" strokeWidth={2.5} />
        Add your own columns
      </span>
    </div>
  );
}

export function TemplateThumbnail({ board, accent, icon, suite, title }: TemplateThumbnailProps) {
  const groups = useMemo(() => buildPreviewGroups(board, { perGroup: 2, now: THUMB_NOW }), [board]);
  if (suite && suite.length > 1) return <SuiteThumbnail boards={suite} accent={accent} />;
  const layout = thumbnailLayout(board);
  // The highlighted tab is the view the body depicts (Kanban → "Lead funnel", Gantt, Calendar…).
  const active = viewForLayout(board, layout);
  const chips = [
    ...(active ? [active.name] : []),
    ...board.views.filter((view) => view !== active).slice(0, 1).map((view) => view.name),
  ];
  return (
    <div
      aria-hidden
      data-layout={layout}
      className="relative flex h-full items-center justify-center overflow-hidden bg-sunken px-4"
      style={{ background: `color-mix(in srgb, var(--label-${accent}) 7%, var(--surface-sunken))` }}
    >
      <div className="w-full max-w-[320px] overflow-hidden rounded-lg border border-border-subtle bg-raised shadow-sm">
        <div className="flex items-center gap-1.5 border-b border-border-subtle px-2 py-1.5">
          <span
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] [&_svg]:size-2.5"
            style={{ background: `var(--label-${accent})`, color: `var(--label-${accent}-fg)` }}
          >
            {icon}
          </span>
          <span className="min-w-0 shrink-0 truncate text-[10.5px] leading-none font-semibold text-fg">{title ?? board.name}</span>
          <span className="ml-auto flex min-w-0 gap-1 overflow-hidden">
            {chips.map((chip, index) => (
              <span
                key={`${chip}-${index}`}
                className={
                  index === 0
                    ? 'shrink-0 rounded-[3px] bg-primary-selected px-1 py-[2px] text-[8.5px] leading-none font-medium text-primary-text'
                    : 'shrink-0 truncate px-0.5 py-[2px] text-[8.5px] leading-none text-fg-muted'
                }
              >
                {chip}
              </span>
            ))}
          </span>
        </div>
        {layout === 'kanban' ? (
          <KanbanBody board={board} groups={groups} />
        ) : layout === 'timeline' ? (
          <TimelineBody groups={groups} />
        ) : layout === 'calendar' ? (
          <CalendarBody groups={groups} />
        ) : layout === 'form' ? (
          <FormBody board={board} groups={groups} />
        ) : layout === 'blank' ? (
          <BlankBody />
        ) : (
          <TableBody board={board} groups={groups} />
        )}
      </div>
    </div>
  );
}

const SUITE_BARS = [38, 62, 48, 84, 70] as const;

/** CRM suite: connected board tiles (Leads → Deals → Accounts…) and a small dashboard chart. */
function SuiteThumbnail({ boards, accent }: { readonly boards: readonly GalleryBoard[]; readonly accent: string }) {
  const tiles = boards.slice(0, 4);
  const extra = boards.length - tiles.length;
  return (
    <div
      aria-hidden
      data-layout="suite"
      className="relative flex h-full items-center justify-center gap-2 overflow-hidden px-3"
      style={{ background: `color-mix(in srgb, var(--label-${accent}) 7%, var(--surface-sunken))` }}
    >
      <div className="relative grid w-[62%] max-w-[210px] grid-cols-2 gap-x-3 gap-y-2">
        {/* Relation lines between the tiles */}
        <svg className="pointer-events-none absolute inset-0 size-full text-border-strong" preserveAspectRatio="none" viewBox="0 0 100 100">
          <path d="M44 25 H56 M44 75 H56 M25 44 V56 M75 44 V56" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 2" fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
        {tiles.map((item, index) => {
          const color = SUITE_TILE_COLORS[index % SUITE_TILE_COLORS.length]!;
          return (
            <div key={item.templateId} className="relative flex min-w-0 flex-col gap-[3px] rounded-[5px] border border-border-subtle bg-raised p-1.5 shadow-xs">
              <span className="flex items-center gap-1">
                <span className="size-2 shrink-0 rounded-[2px]" style={{ background: `var(--label-${color})` }} />
                <span className="truncate text-[9.5px] leading-none font-semibold text-fg">{item.name}</span>
              </span>
              {[0, 1].map((row) => (
                <span key={row} className="flex items-center gap-[3px]">
                  <span className="h-[5px] flex-1 rounded-full bg-muted" />
                  <span className="h-[5px] w-3 rounded-[1px]" style={{ background: `var(--label-${color})` }} />
                </span>
              ))}
            </div>
          );
        })}
        {extra > 0 ? (
          <span className="absolute -right-2 -bottom-2 rounded-full bg-raised px-1.5 py-[2px] text-[8.5px] leading-none font-semibold text-fg-secondary shadow-xs">
            +{extra}
          </span>
        ) : null}
      </div>
      <div className="flex w-[32%] max-w-[110px] flex-col gap-1 rounded-[5px] border border-border-subtle bg-raised p-1.5 shadow-xs">
        <span className="truncate text-[9px] leading-none font-semibold text-fg">Sales dashboard</span>
        <span className="text-[11px] leading-none font-semibold text-fg tabular-nums">$1.2M</span>
        <span className="flex h-[34px] items-end gap-[3px]">
          {SUITE_BARS.map((height, index) => (
            <span
              key={index}
              className="flex-1 rounded-t-[2px]"
              style={{ height: `${height}%`, background: index === SUITE_BARS.length - 1 ? 'var(--primary)' : `color-mix(in srgb, var(--primary) 35%, transparent)` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

const SUITE_TILE_COLORS = ['orange', 'green', 'indigo', 'sky'] as const;
