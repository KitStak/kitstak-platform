'use client';

/**
 * Present / TV mode: chrome-less, full-screen, read-only grid with a live clock. Optionally
 * rotates through every dashboard on a timer (`?rotate=60`). Esc or "Exit" leaves.
 * Browser full screen is requested by the caller inside the click/key handler (a user gesture);
 * see `enterFullscreen`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Minimize2, Repeat } from 'lucide-react';
import { Button, Select } from '@/components/ui';
import { useDashboards } from '@/lib/hooks';
import type { DashboardDto } from '@/server/services/contracts/dto';
import type { InsightFilters } from '@/server/services/contracts/dashboard-insights';
import { DashboardGrid } from './dashboard-grid';
import { WidgetCard, type WidgetActions } from './widget-card';

export interface PresentModeProps {
  readonly dashboard: DashboardDto;
  readonly filters: InsightFilters;
  readonly orgSlug: string;
  readonly refetchInterval: number | false;
  readonly actions: WidgetActions;
  readonly onExit: () => void;
}

/** Call synchronously from the Present click / key handler so the browser accepts it. */
export function enterFullscreen(): void {
  const root = document.documentElement;
  if (document.fullscreenElement || typeof root.requestFullscreen !== 'function') return;
  root.requestFullscreen().catch(() => undefined);
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="text-lg font-medium tabular-nums text-fg">
      {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
    </span>
  );
}

const noop = () => undefined;

export function PresentMode({ dashboard, filters, orgSlug, refetchInterval, actions, onExit }: PresentModeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dashboards = useDashboards();
  const [rotate, setRotateState] = useState(() => Number(searchParams.get('rotate') ?? 0) || 0);
  const renderWidget = useCallback(
    (widget: DashboardDto['widgets'][number]) => (
      <WidgetCard
        dashboardId={dashboard.id}
        widget={widget}
        filters={filters}
        filtered={false}
        orgSlug={orgSlug}
        editable={false}
        readOnly
        refetchInterval={refetchInterval}
        actions={actions}
      />
    ),
    [actions, dashboard.id, filters, orgSlug, refetchInterval],
  );

  useEffect(() => {
    ref.current?.focus();
    // Only leave when the user exits browser full screen after having entered it.
    let wasFullscreen = Boolean(document.fullscreenElement);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExit();
    };
    const onFullscreen = () => {
      if (document.fullscreenElement) wasFullscreen = true;
      else if (wasFullscreen) onExit();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [onExit]);

  useEffect(() => {
    const list = dashboards.data ?? [];
    if (!rotate || list.length < 2) return;
    const id = window.setTimeout(() => {
      const index = list.findIndex((entry) => entry.id === dashboard.id);
      const next = list[(index + 1) % list.length];
      if (next) router.replace(`/${orgSlug}/dashboards/${next.id}?present=1&rotate=${rotate}`);
    }, rotate * 1000);
    return () => window.clearTimeout(id);
  }, [rotate, dashboards.data, dashboard.id, orgSlug, router]);

  const setRotate = (value: string) => {
    setRotateState(Number(value) || 0);
    const params = new URLSearchParams(window.location.search);
    if (value === '0') params.delete('rotate');
    else params.set('rotate', value);
    window.history.replaceState(window.history.state, '', `${pathname}?${params.toString()}`);
  };

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`${dashboard.name}, presentation mode`}
      className="fixed inset-0 z-[var(--z-modal)] overflow-y-auto bg-sunken outline-none ks-dash-fade-in"
      data-testid="present-mode"
    >
      <div className="mx-auto flex max-w-[1920px] flex-col gap-4 p-6">
        <header className="flex flex-wrap items-center gap-4">
          <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold text-fg">{dashboard.name}</h1>
          <Clock />
          <div className="flex items-center gap-2">
            <Repeat aria-hidden className="size-4 text-icon" />
            <Select
              aria-label="Rotate dashboards"
              size="sm"
              value={String(rotate || 0)}
              onValueChange={setRotate}
              options={[
                { value: '0', label: 'No rotation' },
                { value: '30', label: 'Rotate every 30 s' },
                { value: '60', label: 'Rotate every minute' },
                { value: '120', label: 'Rotate every 2 min' },
              ]}
              className="w-[190px]"
            />
          </div>
          <Button variant="secondary" leadingIcon={<Minimize2 />} onClick={onExit}>
            Exit
          </Button>
        </header>
        <DashboardGrid widgets={dashboard.widgets} canMove={false} onCommit={noop} renderWidget={renderWidget} />
      </div>
    </div>
  );
}
