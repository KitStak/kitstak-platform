'use client';

/** Full-screen view of a single widget (large dialog, same data and filters). */
import { useMemo } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import { Dialog, DialogContent } from '@/components/ui';
import type { DashboardWidgetDto } from '@/server/services/contracts/dto';
import { widgetKindOf, type InsightFilters } from '@/server/services/contracts/dashboard-insights';
import { widgetDefinition } from '../lib/catalog';
import { WidgetCard, type WidgetActions } from './widget-card';

export interface WidgetFullscreenProps {
  readonly widget: DashboardWidgetDto | null;
  readonly onClose: () => void;
  readonly dashboardId: string;
  readonly filters: InsightFilters;
  readonly filtered: boolean;
  readonly orgSlug: string;
  readonly actions: WidgetActions;
}

/** Full screen lists far more table rows than a card (the server caps a widget at 200). */
const FULLSCREEN_TABLE_LIMIT = 200;

export function WidgetFullscreen({ widget, onClose, dashboardId, filters, filtered, orgSlug, actions }: WidgetFullscreenProps) {
  const kind = widget ? widgetKindOf(widget.type, widget.config) : null;
  const definition = kind ? widgetDefinition(kind) : null;
  const shown = useMemo(
    () => (widget && kind === 'table' ? { ...widget, config: { ...widget.config, limit: FULLSCREEN_TABLE_LIMIT } } : widget),
    [widget, kind],
  );
  return (
    <Dialog open={Boolean(widget)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="xl" className="h-[min(820px,calc(100dvh-48px))] w-[min(1280px,calc(100vw-32px))] max-w-none" data-testid="widget-fullscreen">
        {widget && shown && definition ? (
          <>
            <div className="flex items-center gap-3 border-b border-border-subtle px-6 py-4 pr-14">
              <RDialog.Title className="truncate font-heading text-xl font-semibold text-fg">{widget.title}</RDialog.Title>
              <RDialog.Description className="sr-only">{definition.label} widget in full screen</RDialog.Description>
            </div>
            <div className="min-h-0 flex-1 p-6">
              <WidgetCard
                bare
                dashboardId={dashboardId}
                widget={shown}
                filters={filters}
                filtered={filtered}
                orgSlug={orgSlug}
                editable={false}
                refetchInterval={false}
                actions={actions}
              />
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
