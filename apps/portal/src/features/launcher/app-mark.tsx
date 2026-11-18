import type { Module } from '@kitstak/entitlements';
import { cn } from '@/components/ui';

/**
 * Product marks from the brand pack (public/brand/kitstak-icon-<app>.svg), inlined with the
 * exact rects so they render crisply at any size and dim cleanly when the app is locked.
 */
const MARKS: Readonly<Record<Module, readonly { x: number; y: number; w: number; h: number; pink?: boolean; opacity?: number }[]>> = {
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
  // The official Pulse mark: a full bar over a meter (faded track, solid fill).
  pulse: [
    { x: 40, y: 62, w: 120, h: 30 },
    { x: 40, y: 108, w: 120, h: 30, pink: true, opacity: 0.35 },
    { x: 40, y: 108, w: 84, h: 30, pink: true },
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
        {MARKS[module].map((rect) => (
          <rect key={`${rect.x}-${rect.y}-${rect.w}`} x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill={rect.pink ? '#D65A6E' : '#C8102E'} opacity={rect.opacity} />
        ))}
      </svg>
    </span>
  );
}
