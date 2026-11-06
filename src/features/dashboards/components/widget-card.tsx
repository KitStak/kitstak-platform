'use client';

/**
 * Widget chrome: header (drag handle, double-click rename, hover actions, "…" menu), body with
 * per-state rendering, resize grip. The insight query lives here so each widget loads on its own.
 */
import { memo, useState, type HTMLAttributes, type PointerEvent as ReactPointerEvent } from 'react';
import {
  AlertTriangle,
  Copy,
  Download,
  GripVertical,
  Maximize2,
  MoreHorizontal,
  PencilLine,
  RefreshCw,
  Settings2,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Spinner,
  cn,
  toLabelColor,
} from '@/components/ui';
import type { DashboardWidgetDto } from '@/server/services/contracts/dto';
import {
  parseWidgetSettings,
  widgetKindOf,
  type InsightFilters,
} from '@/server/services/contracts/dashboard-insights';
import { useWidgetInsight } from '../hooks';
import { widgetDefinition } from '../lib/catalog';
import { KpiGlyph, kpiIconKey } from '../lib/kpi-icons';
import { downloadCsv, insightToCsv } from '../lib/export';
import { STATIC_KINDS, WidgetBody } from '../widgets/widget-body';

export interface WidgetActions {
  readonly onOpenSettings: (widget: DashboardWidgetDto) => void;
  readonly onFullscreen: (widget: DashboardWidgetDto) => void;
  readonly onDuplicate: (widget: DashboardWidgetDto) => void;
  readonly onDelete: (widget: DashboardWidgetDto) => void;
  readonly onRename: (widget: DashboardWidgetDto, title: string) => void;
  readonly onUpdateConfig: (widget: DashboardWidgetDto, patch: Record<string, unknown>) => void;
}

export interface WidgetCardProps {
  readonly dashboardId: string;
  readonly widget: DashboardWidgetDto;
  readonly filters: InsightFilters;
  readonly filtered: boolean;
  readonly orgSlug: string;
  readonly editable: boolean;
  readonly refetchInterval: number | false;
  readonly highlighted?: boolean;
  /** Name of the teammate whose change just arrived live ("Updated by …"). */
  readonly updatedBy?: string;
  /** Optimistic widget whose row is still being created: data shows, actions wait. */
  readonly pending?: boolean;
  /** Its settings panel is open: marked with a primary ring. */
  readonly editing?: boolean;
  readonly dragging?: boolean;
  readonly handleProps?: HTMLAttributes<HTMLElement>;
  readonly onResizeStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly actions: WidgetActions;
  /** Larger rendering inside the full-screen dialog (no chrome). */
  readonly bare?: boolean;
  /** Present / TV mode: no hover actions at all. */
  readonly readOnly?: boolean;
}

function RenameInput({ initial, onDone }: { readonly initial: string; readonly onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      aria-label="Widget title"
      value={value}
      maxLength={255}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => onDone(value.trim() || null)}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') onDone(value.trim() || null);
        if (event.key === 'Escape') onDone(null);
      }}
      className="h-7 min-w-0 flex-1 rounded-sm border border-primary bg-panel px-1.5 text-md font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-soft)]"
    />
  );
}

/**
 * Grid geometry (x/y/w/h) does not affect what a card renders (the slot sizes it), so a move or
 * resize must not re-render widget bodies: compare the widget by its content fields.
 */
function sameCardProps(previous: WidgetCardProps, next: WidgetCardProps): boolean {
  for (const key of Object.keys(next) as (keyof WidgetCardProps)[]) {
    if (key === 'widget') continue;
    if (previous[key] !== next[key]) return false;
  }
  const a = previous.widget;
  const b = next.widget;
  return a === b || (a.id === b.id && a.type === b.type && a.title === b.title && a.config === b.config);
}

export const WidgetCard = memo(function WidgetCard({
  dashboardId,
  widget,
  filters,
  filtered,
  orgSlug,
  editable,
  refetchInterval,
  highlighted,
  updatedBy,
  pending,
  editing,
  dragging,
  handleProps,
  onResizeStart,
  actions,
  bare,
  readOnly,
}: WidgetCardProps) {
  const kind = widgetKindOf(widget.type, widget.config);
  const settings = parseWidgetSettings(widget.config);
  const definition = widgetDefinition(kind);
  const isStatic = STATIC_KINDS.has(kind);
  const query = useWidgetInsight(dashboardId, widget, filters, { enabled: !isStatic, refetchInterval });
  const [renaming, setRenaming] = useState(false);
  // Numbers widgets may pick their own glyph and accent; text tokens keep the glyph legible on
  // its tint in dark mode.
  const customIcon = kind === 'numbers' ? kpiIconKey(settings.icon) : null;
  const Icon = definition.icon;
  const tone = kind === 'numbers' && settings.color ? toLabelColor(settings.color, definition.tone) : definition.tone;
  // Data for the previous filters is still on screen while the new request runs: dim it so
  // stale numbers never read as current.
  const stale = query.isPlaceholderData && query.isFetching;
  // The last refresh failed but older data is still on screen: say so instead of hiding it.
  const refreshFailed = query.isError && query.data !== undefined && !query.isFetching;
  const showActions = !readOnly && !pending;
  const body = (
    <WidgetBody
      kind={kind}
      insight={query.data}
      isPending={query.isPending}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      settings={settings}
      filtered={filtered}
      orgSlug={orgSlug}
      title={widget.title}
      editable={editable && !pending}
      expanded={bare}
      onConfigure={editable && !pending ? () => actions.onOpenSettings(widget) : undefined}
      onUpdateConfig={(patch) => actions.onUpdateConfig(widget, { ...widget.config, ...patch })}
    />
  );
  const staleBody = (
    <div
      className={cn('h-full min-h-0 transition-opacity duration-[var(--duration-fast)] ease-out', stale && 'pointer-events-none opacity-60')}
      aria-busy={stale || undefined}
      data-stale={stale || undefined}
    >
      {body}
    </div>
  );
  if (bare) return staleBody;

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Widget actions" icon={<MoreHorizontal />} size="sm" data-testid="widget-menu" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        {editable ? (
          <>
            <DropdownMenuItem icon={<Settings2 />} onSelect={() => actions.onOpenSettings(widget)}>
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem icon={<PencilLine />} onSelect={() => setRenaming(true)}>
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Copy />} onSelect={() => actions.onDuplicate(widget)}>
              Duplicate
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuItem icon={<Maximize2 />} onSelect={() => actions.onFullscreen(widget)}>
          Full screen
        </DropdownMenuItem>
        {!isStatic ? (
          <>
            <DropdownMenuItem icon={<RefreshCw />} onSelect={() => void query.refetch()}>
              Refresh data
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Download />} disabled={!query.data} onSelect={() => query.data && downloadCsv(widget.title, insightToCsv(query.data))}>
              Export CSV
            </DropdownMenuItem>
          </>
        ) : null}
        {editable ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Trash2 />} variant="danger" onSelect={() => actions.onDelete(widget)}>
              Delete widget
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (definition.chromeless) {
    return (
      <section
        aria-label={widget.title}
        data-testid="dashboard-widget"
        data-widget-kind={kind}
        className={cn('group/widget relative flex h-full flex-col rounded-lg px-1', highlighted && 'ks-dash-pulse', dragging && 'bg-panel shadow-lg')}
      >
        <div {...handleProps} className={cn('flex min-h-0 flex-1 items-end gap-2 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-focus', handleProps && 'cursor-grab active:cursor-grabbing')}>
          <div className="min-w-0 flex-1" onDoubleClick={editable ? () => setRenaming(true) : undefined}>
            {renaming ? (
              <RenameInput initial={widget.title} onDone={(value) => { setRenaming(false); if (value && value !== widget.title) actions.onRename(widget, value); }} />
            ) : (
              body
            )}
          </div>
          <div className={cn(showActions ? 'flex' : 'hidden', 'mb-2 shrink-0 items-center opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover/widget:opacity-100 group-focus-within/widget:opacity-100')} onPointerDown={(event) => event.stopPropagation()}>
            {menu}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label={widget.title}
      data-testid="dashboard-widget"
      data-widget-id={widget.id}
      data-widget-kind={kind}
      data-pending={pending || undefined}
      aria-busy={pending || undefined}
      className={cn(
        '@container/widget group/widget relative flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-panel shadow-xs',
        'transition-[box-shadow,border-color,transform] duration-[var(--duration-fast)] ease-out hover:border-border-default hover:shadow-sm',
        dragging && 'scale-[1.01] border-primary shadow-lg',
        editing && 'border-primary ring-2 ring-primary',
        highlighted && 'ks-dash-pulse',
      )}
    >
      <header
        {...handleProps}
        className={cn(
          'flex h-12 shrink-0 items-center gap-2 pr-2 pl-4 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
          handleProps && 'cursor-grab active:cursor-grabbing',
        )}
      >
        {handleProps ? (
          <GripVertical aria-hidden className="-ml-2.5 size-4 shrink-0 text-icon opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover/widget:opacity-60" />
        ) : null}
        <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-sm [&_svg]:size-3.5" style={{ background: `var(--label-${tone}-subtle)`, color: `var(--label-${tone}-text, var(--label-${tone}))` }}>
          {customIcon ? <KpiGlyph name={customIcon} /> : <Icon />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          {renaming ? (
            <RenameInput
              initial={widget.title}
              onDone={(value) => {
                setRenaming(false);
                if (value && value !== widget.title) actions.onRename(widget, value);
              }}
            />
          ) : (
            <h3
              className="truncate text-md font-semibold text-fg"
              title={widget.title}
              onDoubleClick={editable ? () => setRenaming(true) : undefined}
            >
              {widget.title}
            </h3>
          )}
          {settings.description ? <p className="truncate text-xs text-fg-muted">{settings.description}</p> : null}
        </div>
        {pending ? (
          <span className="shrink-0 text-xs text-fg-muted" data-testid="widget-saving">
            Saving…
          </span>
        ) : null}
        {updatedBy ? (
          <span className="ks-dash-fade-in max-w-[40%] shrink-0 truncate rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-medium text-primary-text" data-testid="widget-updated-by">
            Updated by {updatedBy}
          </span>
        ) : null}
        {refreshFailed ? (
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => void query.refetch()}
            title="The last refresh failed. The numbers shown may be out of date."
            className="flex h-6 shrink-0 items-center gap-1 rounded-full bg-warning-subtle px-2 text-xs font-medium text-warning-text transition-colors duration-[var(--duration-fast)] ease-out hover:bg-warning-subtle/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus active:translate-y-px"
            data-testid="widget-refresh-failed"
          >
            <AlertTriangle aria-hidden className="size-3" />
            <span className="hidden @[260px]/widget:inline">Couldn&apos;t refresh ·</span> Retry
          </button>
        ) : null}
        {query.isFetching && query.data && !stale ? <Spinner size="sm" label="Refreshing" /> : null}
        {showActions ? (
          // In the header row (not overlaid), so the title truncates before the actions. Narrow
          // cards keep only the "…" menu, which holds every action.
          <div
            className={cn(
              'flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-[var(--duration-fast)] ease-out',
              'group-hover/widget:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100',
              '[@media(hover:none)]:opacity-100',
            )}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {editable ? (
              <span className="hidden @[300px]/widget:inline-flex">
                <IconButton label="Widget settings" icon={<Settings2 />} size="sm" onClick={() => actions.onOpenSettings(widget)} />
              </span>
            ) : null}
            <span className="hidden @[300px]/widget:inline-flex">
              <IconButton label="Full screen" icon={<Maximize2 />} size="sm" onClick={() => actions.onFullscreen(widget)} />
            </span>
            {menu}
          </div>
        ) : null}
      </header>
      {stale ? <span aria-hidden className="ks-dash-shimmer pointer-events-none absolute top-12 right-0 left-0 h-0.5" /> : null}
      <div className="min-h-0 flex-1 px-4 pb-4">{staleBody}</div>
      {onResizeStart ? (
        <span
          role="presentation"
          onPointerDown={onResizeStart}
          className="absolute right-0 bottom-0 z-[2] flex size-5 cursor-se-resize items-end justify-end p-1 opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover/widget:opacity-100 touch-none"
          data-testid="widget-resize"
        >
          <svg viewBox="0 0 8 8" className="size-2.5 text-icon" aria-hidden>
            <path d="M8 0v8H0z" fill="currentColor" opacity="0.55" />
          </svg>
        </span>
      ) : null}
    </section>
  );
}, sameCardProps);
