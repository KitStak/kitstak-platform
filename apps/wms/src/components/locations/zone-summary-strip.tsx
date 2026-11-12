'use client';

/**
 * Zone summary strip above the Locations grid. Each card shows bins, occupancy and stored
 * units for a zone; clicking toggles the `f.locationZoneId` filter (so it shows as a chip and
 * round-trips through the URL).
 */
import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export interface ZoneCardData {
  readonly zoneId: string | null;
  readonly zone: string;
  readonly warehouseCode?: string | null;
  readonly binCount: number;
  readonly occupiedCount: number;
  readonly storedUnits: number;
}

export function occupancyPct(zone: Pick<ZoneCardData, 'binCount' | 'occupiedCount'>): number {
  return zone.binCount === 0 ? 0 : Math.round((zone.occupiedCount / zone.binCount) * 100);
}

/** 950 → "950", 22,982 → "23k", 1,250,000 → "1.3M" (cards keep one line). */
export function compactCount(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return String(n);
  if (abs < 10_000) return `${(n / 1000).toFixed(1).replace(/.0$/, '')}k`;
  if (abs < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/.0$/, '')}M`;
}

/** Groups zone cards by warehouse (stable first-seen order) so same-named zones sit apart. */
export function groupZonesByWarehouse(
  zones: readonly ZoneCardData[],
): readonly { readonly warehouseCode: string; readonly zones: readonly ZoneCardData[] }[] {
  const groups = new Map<string, ZoneCardData[]>();
  for (const z of zones) {
    const k = z.warehouseCode ?? '';
    const list = groups.get(k);
    if (list) list.push(z);
    else groups.set(k, [z]);
  }
  return [...groups].map(([warehouseCode, list]) => ({ warehouseCode, zones: list }));
}

function tone(pct: number): { bar: string; text: string } {
  if (pct >= 90) return { bar: 'bg-danger', text: 'text-danger' };
  if (pct >= 70) return { bar: 'bg-warning', text: 'text-warning' };
  return { bar: 'bg-success', text: 'text-success' };
}

/** Badge colour per warehouse so same-named zones in two warehouses read as different tiles. */
const WAREHOUSE_BADGES = ['bg-primary', 'bg-info', 'bg-success', 'bg-warning', 'bg-neutral'] as const;

function ZoneCard({
  zone,
  active,
  showWarehouse,
  badgeClass,
  onSelect,
}: {
  readonly zone: ZoneCardData;
  readonly active: boolean;
  readonly showWarehouse: boolean;
  readonly badgeClass: string;
  readonly onSelect: () => void;
}) {
  const pct = occupancyPct(zone);
  const t = tone(pct);
  const badge = zone.zoneId === null ? '—' : zone.zone.slice(0, 4).toUpperCase();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      title={`${showWarehouse && zone.warehouseCode ? `${zone.warehouseCode} · ` : ''}${zone.occupiedCount.toLocaleString('en-US')} of ${zone.binCount.toLocaleString('en-US')} bins occupied · ${zone.storedUnits.toLocaleString('en-US')} units`}
      className={cn(
        'flex h-[70px] min-w-[184px] max-w-[260px] shrink-0 grow basis-0 snap-start flex-col justify-between gap-2 rounded-lg border bg-surface px-3 py-2.5 text-left shadow-xs transition-[border-color,background-color,transform] duration-150',
        'outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.99]',
        active
          ? 'border-primary bg-primary-soft/50 ring-1 ring-primary/30'
          : 'border-border hover:border-border-strong hover:bg-surface-sunken',
      )}
    >
      <span className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white',
            zone.zoneId === null ? 'bg-neutral' : badgeClass,
            badge.length > 2 ? 'text-2xs font-semibold' : 'text-sm font-bold',
          )}
        >
          {badge}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-foreground">
              {zone.zoneId === null ? 'No zone' : `Zone ${zone.zone}`}
            </span>
            {showWarehouse && zone.warehouseCode ? (
              <span className="shrink-0 rounded border border-border bg-surface-sunken px-1 text-2xs font-medium leading-4 text-secondary">
                {zone.warehouseCode}
              </span>
            ) : null}
          </span>
          <span className="truncate whitespace-nowrap text-2xs tabular-nums text-faint">
            {compactCount(zone.binCount)} bins · {compactCount(zone.storedUnits)} units
          </span>
        </span>
      </span>
      <span className="flex items-center gap-2">
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-soft">
          <span className={cn('block h-full rounded-full', t.bar)} style={{ width: `${pct}%` }} />
        </span>
        <span className={cn('w-9 shrink-0 text-right text-2xs font-medium tabular-nums', t.text)}>
          {pct}%
        </span>
      </span>
    </button>
  );
}

export function ZoneSummaryStrip({
  zones,
  loading,
  activeZoneId,
  onToggle,
}: {
  readonly zones: readonly ZoneCardData[];
  readonly loading: boolean;
  readonly activeZoneId: string | null | undefined;
  readonly onToggle: (zoneId: string | null) => void;
}) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ left: false, right: false });
  const measure = React.useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);
  React.useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, zones.length, loading]);
  if (!loading && zones.length === 0) return null;
  // Without a single-warehouse filter the strip mixes warehouses: qualify each card with its warehouse.
  const warehouseCount = new Set(zones.map((z) => z.warehouseCode).filter(Boolean)).size;
  const showWarehouse = warehouseCount > 1;
  const whOrder = [...new Set(zones.map((z) => z.warehouseCode ?? ''))];
  const badgeFor = (z: ZoneCardData) =>
    showWarehouse
      ? WAREHOUSE_BADGES[Math.max(0, whOrder.indexOf(z.warehouseCode ?? '')) % WAREHOUSE_BADGES.length]
      : 'bg-primary';
  const scrollBy = (dir: 1 | -1) =>
    scroller.current?.scrollBy({
      left: dir * Math.max(200, (scroller.current.clientWidth ?? 0) * 0.8),
      behavior: 'smooth',
    });
  const arrow =
    'absolute top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-secondary shadow-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';
  return (
    <div className="px-6 pt-3" aria-label="Zones" role="region">
      <div className="relative">
        <div
          ref={scroller}
          onScroll={measure}
          className="ks-scroll flex snap-x snap-mandatory scroll-px-1 gap-2.5 overflow-x-auto scroll-smooth pb-1"
        >
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[70px] min-w-[184px] flex-1 rounded-lg" />
              ))
            : groupZonesByWarehouse(zones).map((grp, gi) => (
                <React.Fragment key={grp.warehouseCode || 'none'}>
                  {showWarehouse ? (
                    <div
                      role="presentation"
                      className={cn(
                        'flex shrink-0 snap-start flex-col items-center justify-center px-1',
                        gi > 0 && 'ml-1.5 border-l border-border pl-3',
                      )}
                    >
                      <span className="text-2xs font-medium text-faint">Warehouse</span>
                      <span className="text-sm font-semibold text-foreground">
                        {grp.warehouseCode || '—'}
                      </span>
                    </div>
                  ) : null}
                  {grp.zones.map((z) => (
                    <ZoneCard
                      key={`${z.warehouseCode ?? ''}-${z.zoneId ?? 'none'}`}
                      zone={z}
                      showWarehouse={false}
                      badgeClass={badgeFor(z)}
                      active={activeZoneId !== undefined && activeZoneId === z.zoneId}
                      onSelect={() => onToggle(z.zoneId)}
                    />
                  ))}
                </React.Fragment>
              ))}
        </div>
        {edges.left ? (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-background to-transparent"
            />
            <button
              type="button"
              aria-label="Scroll zones left"
              onClick={() => scrollBy(-1)}
              className={cn(arrow, '-left-3')}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
          </>
        ) : null}
        {edges.right ? (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent"
            />
            <button
              type="button"
              aria-label={`Scroll zones right (${zones.length} zones)`}
              onClick={() => scrollBy(1)}
              className={cn(arrow, '-right-3')}
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
