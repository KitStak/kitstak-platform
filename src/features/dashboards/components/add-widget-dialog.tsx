'use client';

/**
 * Add widget wizard: 1) gallery (category rail, search, tiles with previews and descriptions),
 * 2) configure with a live preview of real data, 3) place: pick a size (S / M / L); it drops
 * into the first free slot, scrolls into view and pulses, and shows the preview data at once.
 */
import { useMemo, useState } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import { ArrowLeft, Plus, Search } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  IconButton,
  SearchInput,
  cn,
} from '@/components/ui';
import type { DashboardSourcesDto, InsightDto, InsightFilters, WidgetKind } from '@/server/services/contracts/dashboard-insights';
import { parseWidgetSettings, widgetTypeForKind } from '@/server/services/contracts/dashboard-insights';
import { useWidgetPreview } from '../hooks';
import { CATEGORY_LABELS, defaultWidget, searchWidgets, widgetDefinition, type WidgetCategory } from '../lib/catalog';
import { WidgetBody } from '../widgets/widget-body';
import { WidgetConfigForm } from './widget-config-form';
import { WidgetThumbnail } from './widget-thumbnail';

export type WidgetSizePreset = 'S' | 'M' | 'L';

export interface NewWidget {
  readonly kind: WidgetKind;
  readonly title: string;
  readonly config: Record<string, unknown>;
  readonly size?: WidgetSizePreset;
  /** Data the live preview already computed (seeds the placed widget, no refetch flash). */
  readonly preview?: InsightDto;
}

export interface AddWidgetDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly dashboardId: string;
  readonly initialKind?: WidgetKind | null;
  readonly sources: DashboardSourcesDto | undefined;
  readonly dashboardBoardIds: readonly string[];
  readonly filters: InsightFilters;
  readonly orgSlug: string;
  readonly adding: boolean;
  readonly onAdd: (widget: NewWidget) => void;
  /** Where focus goes when the dialog closes (the trigger may have unmounted). */
  readonly onCloseAutoFocus?: (event: Event) => void;
}

const CATEGORIES: readonly (WidgetCategory | 'all')[] = ['all', 'popular', 'charts', 'sales', 'time', 'content'];

export function AddWidgetDialog(props: AddWidgetDialogProps) {
  const { open, onOpenChange } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" hideClose onCloseAutoFocus={props.onCloseAutoFocus} className="flex h-[min(680px,calc(100dvh-32px))] w-[min(1040px,calc(100vw-24px))] max-w-none flex-col overflow-hidden rounded-2xl p-0" data-testid="add-widget-dialog">
        {open ? <AddWidgetFlow key={props.initialKind ?? 'gallery'} {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AddWidgetFlow({ dashboardId, initialKind, sources, dashboardBoardIds, filters, orgSlug, adding, onAdd, onOpenChange }: AddWidgetDialogProps) {
  const boards = useMemo(() => sources?.boards ?? [], [sources]);
  const connected = boards.filter((board) => dashboardBoardIds.includes(board.id));
  const start = (kind: WidgetKind) => {
    const defaults = defaultWidget(kind, connected.length > 0 ? connected : boards.slice(0, 1));
    return { kind, title: defaults.title, config: defaults.config };
  };
  const [draft, setDraft] = useState<NewWidget | null>(() => (initialKind ? start(initialKind) : null));
  if (!draft) {
    return <Gallery onPick={(kind) => setDraft(start(kind))} onClose={() => onOpenChange(false)} />;
  }
  return (
    <Configure
      dashboardId={dashboardId}
      draft={draft}
      onDraft={setDraft}
      sources={sources}
      dashboardBoardIds={dashboardBoardIds}
      filters={filters}
      orgSlug={orgSlug}
      adding={adding}
      onBack={() => setDraft(null)}
      onCancel={() => onOpenChange(false)}
      onAdd={(preview) => onAdd({ ...draft, preview })}
    />
  );
}

function Gallery({ onPick, onClose }: { readonly onPick: (kind: WidgetKind) => void; readonly onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<WidgetCategory | 'all'>('all');
  const results = searchWidgets(query, category);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border-subtle px-6 py-4">
        <div className="min-w-0 flex-1">
          <RDialog.Title className="text-xl font-semibold text-fg">Add a widget</RDialog.Title>
          <RDialog.Description className="text-sm text-fg-secondary">Pick a widget, then shape it with live data before placing it.</RDialog.Description>
        </div>
        <SearchInput value={query} onValueChange={setQuery} placeholder="Search widgets" aria-label="Search widgets" containerClassName="hidden w-64 sm:flex" autoFocus />
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Widget categories" className="hidden w-52 shrink-0 flex-col gap-0.5 border-r border-border-subtle bg-sunken p-3 sm:flex">
          {CATEGORIES.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-current={category === entry ? 'true' : undefined}
              onClick={() => setCategory(entry)}
              className={cn(
                'flex h-9 items-center rounded-sm px-3 text-left text-base outline-none transition-colors duration-[var(--duration-instant)]',
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                category === entry ? 'bg-primary-selected font-medium text-primary-text' : 'text-fg hover:bg-hover',
              )}
            >
              {entry === 'all' ? 'All widgets' : CATEGORY_LABELS[entry]}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <SearchInput value={query} onValueChange={setQuery} placeholder="Search widgets" aria-label="Search widgets" containerClassName="mb-4 sm:hidden" />
          {results.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Search aria-hidden className="size-6 text-fg-muted" />
              <p className="font-semibold text-fg">No widgets match “{query}”</p>
              <Button variant="tertiary" size="sm" onClick={() => setQuery('')}>
                Clear search
              </Button>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="widget-gallery">
              {results.map((definition) => (
                <li key={definition.kind}>
                  <button
                    type="button"
                    onClick={() => onPick(definition.kind)}
                    data-testid={`widget-tile-${definition.kind}`}
                    className={cn(
                      'group flex w-full flex-col overflow-hidden rounded-lg border border-border-subtle bg-panel text-left outline-none',
                      'transition-[transform,box-shadow,border-color] duration-[var(--duration-fast)] ease-out',
                      'hover:-translate-y-0.5 hover:border-border-default hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:translate-y-0',
                    )}
                  >
                    <span className="relative block aspect-[160/96] bg-sunken p-3">
                      <WidgetThumbnail kind={definition.kind} />
                      <span className="absolute right-3 bottom-3 inline-flex h-7 items-center gap-1 rounded-sm bg-primary px-2.5 text-sm font-medium text-primary-fg opacity-0 shadow-sm transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100 group-focus-visible:opacity-100">
                        <Plus aria-hidden className="size-3.5" /> Add
                      </span>
                    </span>
                    <span className="flex flex-col gap-0.5 px-4 py-3">
                      <span className="text-base font-semibold text-fg">{definition.label}</span>
                      <span className="line-clamp-2 text-sm text-fg-secondary">{definition.description}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-border-subtle px-6 py-3">
        <p className="hidden text-sm text-fg-muted sm:block">
          {results.length} {results.length === 1 ? 'widget' : 'widgets'} · Every widget previews your real data before you add it.
        </p>
        <Button variant="ghost" onClick={onClose} className="ml-auto">
          Cancel
        </Button>
      </footer>
    </div>
  );
}

const SIZE_OPTIONS: readonly { readonly value: WidgetSizePreset; readonly label: string }[] = [
  { value: 'S', label: 'Small' },
  { value: 'M', label: 'Medium' },
  { value: 'L', label: 'Large' },
];

function SizePicker({ value, onChange }: { readonly value: WidgetSizePreset; readonly onChange: (value: WidgetSizePreset) => void }) {
  return (
    <div role="radiogroup" aria-label="Widget size" className="flex items-center gap-1 rounded-md border border-border-subtle p-0.5" data-testid="widget-size">
      {SIZE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-7 min-w-8 rounded-sm px-2 text-sm font-semibold outline-none transition-colors duration-[var(--duration-instant)] focus-visible:outline-2 focus-visible:outline-focus',
            value === option.value ? 'bg-primary-subtle text-primary-text' : 'text-fg-secondary hover:bg-hover',
          )}
        >
          {option.value}
        </button>
      ))}
    </div>
  );
}

interface ConfigureProps {
  readonly dashboardId: string;
  readonly draft: NewWidget;
  readonly onDraft: (draft: NewWidget) => void;
  readonly sources: DashboardSourcesDto | undefined;
  readonly dashboardBoardIds: readonly string[];
  readonly filters: InsightFilters;
  readonly orgSlug: string;
  readonly adding: boolean;
  readonly onBack: () => void;
  readonly onCancel: () => void;
  readonly onAdd: (preview: InsightDto | undefined) => void;
}

function Configure({ dashboardId, draft, onDraft, sources, dashboardBoardIds, filters, orgSlug, adding, onBack, onCancel, onAdd }: ConfigureProps) {
  const definition = widgetDefinition(draft.kind);
  const preview = useWidgetPreview(dashboardId, { type: widgetTypeForKind(draft.kind), config: draft.config }, filters);
  const settings = parseWidgetSettings(draft.config);
  const Icon = definition.icon;
  const canAdd = draft.title.trim().length > 0 && !adding;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 sm:px-6">
        <IconButton label="Back to gallery" icon={<ArrowLeft />} onClick={onBack} />
        <span aria-hidden className="flex size-8 items-center justify-center rounded-md [&_svg]:size-4" style={{ background: `var(--label-${definition.tone}-subtle)`, color: `var(--label-${definition.tone})` }}>
          <Icon />
        </span>
        <div className="min-w-0 flex-1">
          <RDialog.Title className="truncate text-lg font-semibold text-fg">Configure {definition.label.toLowerCase()}</RDialog.Title>
          <RDialog.Description className="truncate text-sm text-fg-secondary">{definition.description}</RDialog.Description>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col-reverse md:flex-row">
        <div className="min-h-0 overflow-y-auto border-border-subtle md:w-[380px] md:shrink-0 md:border-r">
          {sources ? (
            <WidgetConfigForm
              kind={draft.kind}
              title={draft.title}
              config={draft.config}
              boards={sources.boards}
              dashboardBoardIds={dashboardBoardIds}
              preview={preview.data}
              onTitleChange={(title) => onDraft({ ...draft, title })}
              onChange={(config) => onDraft({ ...draft, config })}
            />
          ) : (
            <div className="flex flex-col gap-3 p-5" data-skeleton>
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="h-10 animate-pulse rounded-sm bg-skeleton" />
              ))}
            </div>
          )}
        </div>
        <section aria-label="Live preview" className="flex min-h-[260px] flex-1 flex-col bg-sunken p-4 sm:p-6">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-fg-muted ">
            Live preview
            {preview.isFetching ? <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-label="Updating preview" /> : null}
          </p>
          <div className={cn('flex min-h-0 flex-1 flex-col rounded-lg', definition.chromeless ? 'justify-center px-2' : 'border border-border-subtle bg-panel shadow-sm')}>
            {!definition.chromeless ? (
              <div className="flex h-12 items-center px-4">
                <h3 className="truncate text-md font-semibold text-fg">{draft.title || 'Untitled widget'}</h3>
              </div>
            ) : null}
            <div className={cn('min-h-0 flex-1', !definition.chromeless && 'px-4 pb-4')} style={{ maxHeight: definition.chromeless ? 96 : undefined }}>
              <WidgetBody
                kind={draft.kind}
                insight={preview.data}
                isPending={preview.isPending}
                isError={preview.isError}
                onRetry={() => void preview.refetch()}
                settings={settings}
                filtered={false}
                orgSlug={orgSlug}
                title={draft.title}
                editable={false}
              />
            </div>
          </div>
        </section>
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-border-subtle px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          {!definition.chromeless ? <SizePicker value={draft.size ?? 'M'} onChange={(size) => onDraft({ ...draft, size })} /> : null}
          <p className="hidden text-sm text-fg-muted lg:block">Drops into the first free spot; drag it anywhere afterwards.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onAdd(preview.isPlaceholderData ? undefined : preview.data)} disabled={!canAdd} loading={adding} leadingIcon={<Plus />} data-testid="add-widget-confirm">
            Add widget
          </Button>
        </div>
      </footer>
    </div>
  );
}
