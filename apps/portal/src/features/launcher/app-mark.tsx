import type { Module } from '@kitstak/entitlements';
import { cn } from '@/components/ui';

/**
 * Product marks from the brand pack (public/brand/kitstak-icon-<app>.svg), inlined with the
 * exact rects and polygons so they render crisply at any size and dim cleanly when the app is locked.
 */
interface RectMark {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly pink?: boolean;
}
/** A polygon from the brand file, its `points` copied as written. */
interface PolygonMark {
  readonly points: string;
  readonly pink?: boolean;
}
type Mark = RectMark | PolygonMark;

const markFill = (mark: Mark): string => (mark.pink ? '#D65A6E' : '#C8102E');

const MARKS: Readonly<Record<Module, readonly Mark[]>> = {
  crm: [
    { x: 36, y: 50, w: 128, h: 26 },
    { x: 56, y: 87, w: 88, h: 26, pink: true },
    { x: 76, y: 124, w: 48, h: 26 },
  ],
  wms: [
    { x: 46, y: 54, w: 30, h: 28, pink: true },
    { x: 86, y: 62, w: 26, h: 20, pink: true },
    { x: 122, y: 50, w: 32, h: 32, pink: true },
    { x: 34, y: 82, w: 132, h: 14 },
    { x: 44, y: 110, w: 36, h: 26, pink: true },
    { x: 90, y: 116, w: 28, h: 20, pink: true },
    { x: 128, y: 106, w: 26, h: 30, pink: true },
    { x: 34, y: 136, w: 132, h: 14 },
  ],
  projects: [
    { x: 38, y: 52, w: 80, h: 26 },
    { x: 68, y: 87, w: 80, h: 26, pink: true },
    { x: 98, y: 122, w: 64, h: 26 },
  ],
  // The official Pulse mark: two notched bars, red over pink.
  pulse: [
    { points: '40,71 82,71 100,53 118,71 160,71 160,101 118,101 100,83 82,101 40,101' },
    { points: '40,117 82,117 100,99 118,117 160,117 160,147 118,147 100,129 82,147 40,147', pink: true },
  ],
};

export function AppMark({ module, locked, className }: { readonly module: Module; readonly locked?: boolean; readonly className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border-subtle',
        locked ? 'bg-sunken opacity-60 grayscale' : 'bg-panel',
        className,
      )}
    >
      <svg viewBox="28 40 144 120" width="30" height="25">
        {MARKS[module].map((mark) =>
          'points' in mark ? (
            <polygon key={mark.points} points={mark.points} fill={markFill(mark)} />
          ) : (
            <rect key={`${mark.x}-${mark.y}-${mark.w}`} x={mark.x} y={mark.y} width={mark.w} height={mark.h} fill={markFill(mark)} />
          ),
        )}
      </svg>
    </span>
  );
}
