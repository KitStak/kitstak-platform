'use client';

/**
 * Widget settings side panel (non-modal, 392px). Changes autosave after a short pause and the
 * widget on the canvas updates live. "Reset to defaults" re-derives columns from the boards.
 * Esc closes it (unless an inner menu or picker is open, which Esc closes first) and focus
 * returns to the widget's settings button. The page reserves the panel's width so the header
 * and toolbar stay reachable.
 */
import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button, Drawer, DrawerContent } from '@/components/ui';
import type { DashboardWidgetDto } from '@/server/services/contracts/dto';
import {
  parseWidgetSettings,
  widgetKindOf,
  type DashboardSourcesDto,
  type InsightFilters,
} from '@/server/services/contracts/dashboard-insights';
import { useWidgetPreview } from '../hooks';
import { defaultWidget, widgetDefinition } from '../lib/catalog';
import { WidgetConfigForm } from './widget-config-form';

const AUTOSAVE_MS = 450;

export const SETTINGS_PANEL_WIDTH = 392;

/** True while a Radix popper (select, menu, popover, tooltip) is open inside the page. */
function innerLayerOpen(): boolean {
  return document.querySelector('[data-radix-popper-content-wrapper] [data-state="open"], [role="listbox"][data-state="open"], [role="menu"][data-state="open"]') !== null;
}

export interface WidgetSettingsPanelProps {
  readonly dashboardId: string;
  readonly widget: DashboardWidgetDto | null;
  readonly sources: DashboardSourcesDto | undefined;
  readonly dashboardBoardIds: readonly string[];
  readonly filters: InsightFilters;
  readonly onClose: () => void;
  readonly onSave: (widget: DashboardWidgetDto, patch: { title?: string; config?: Record<string, unknown> }) => void;
  /** Focus target after the panel closes (the widget's settings button). */
  readonly onCloseAutoFocus?: (event: Event) => void;
}

export function WidgetSettingsPanel(props: WidgetSettingsPanelProps) {
  const { widget, onClose } = props;
  const kind = widget ? widgetKindOf(widget.type, widget.config) : 'numbers';
  const definition = widgetDefinition(kind);
  const open = Boolean(widget);
  // Esc anywhere on the page closes the non-modal panel; inner pickers get the first Esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (innerLayerOpen()) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"][aria-modal="true"]')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <Drawer open={Boolean(widget)} onOpenChange={(open) => (open ? undefined : onClose())} modal={false}>
      <DrawerContent
        width={SETTINGS_PANEL_WIDTH}
        modal={false}
        onOpenAutoFocus={(event) => {
          // Keep focus off the close button so its tooltip does not pop up on open.
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        onCloseAutoFocus={props.onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          if (!innerLayerOpen()) onClose();
        }}
        title={`${definition.label} settings`}
        description="Changes save automatically."
        onInteractOutside={(event) => event.preventDefault()}
        data-testid="widget-settings-panel"
      >
        {widget ? <PanelBody key={widget.id} {...props} widget={widget} /> : null}
      </DrawerContent>
    </Drawer>
  );
}

function PanelBody({ dashboardId, widget, sources, dashboardBoardIds, filters, onSave }: WidgetSettingsPanelProps & { readonly widget: DashboardWidgetDto }) {
  const kind = widgetKindOf(widget.type, widget.config);
  const [title, setTitle] = useState(widget.title);
  const [config, setConfig] = useState<Record<string, unknown>>(widget.config);
  const timer = useRef<number | null>(null);
  const [pending, setPending] = useState(false);
  const latest = useRef({ title, config });
  useEffect(() => {
    latest.current = { title, config };
  });
  const preview = useWidgetPreview(dashboardId, { type: widget.type, config }, filters);

  const schedule = (next: { title?: string; config?: Record<string, unknown> }) => {
    if (timer.current) window.clearTimeout(timer.current);
    setPending(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setPending(false);
      const patch = { ...(next.title !== undefined && next.title.trim() ? { title: next.title.trim() } : {}), ...(next.config ? { config: next.config } : {}) };
      if (Object.keys(patch).length > 0) onSave(widget, patch);
    }, AUTOSAVE_MS);
  };

  // Flush a pending save when the panel closes or switches widget.
  useEffect(
    () => () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        const { title: pendingTitle, config: pendingConfig } = latest.current;
        onSave(widget, { ...(pendingTitle.trim() ? { title: pendingTitle.trim() } : {}), config: pendingConfig });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flush once on unmount only
    [],
  );

  const reset = () => {
    const boards = (sources?.boards ?? []).filter((board) => (parseWidgetSettings(config).boardIds ?? dashboardBoardIds).includes(board.id));
    const defaults = defaultWidget(kind, boards);
    setConfig(defaults.config);
    schedule({ config: defaults.config });
  };

  if (!sources) {
    return (
      <div className="flex flex-col gap-3 p-5" data-skeleton>
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className="h-10 animate-pulse rounded-sm bg-skeleton" />
        ))}
      </div>
    );
  }
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1">
        <WidgetConfigForm
          kind={kind}
          title={title}
          config={config}
          boards={sources.boards}
          dashboardBoardIds={dashboardBoardIds}
          preview={preview.data}
          onTitleChange={(next) => {
            setTitle(next);
            schedule({ title: next, config });
          }}
          onChange={(next) => {
            setConfig(next);
            schedule({ title, config: next });
          }}
        />
      </div>
      <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-border-subtle bg-raised px-5 py-3">
        <Button variant="ghost" size="sm" leadingIcon={<RotateCcw />} onClick={reset}>
          Reset to defaults
        </Button>
        <span className="text-xs text-fg-muted" aria-live="polite">
          {pending ? 'Saving…' : 'All changes saved'}
        </span>
      </div>
    </div>
  );
}
