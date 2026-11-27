/**
 * KitStak app icons, built 1:1 from the supplied brand export (KitStak Brand Assets/Icons): each
 * shape below is a rectangle or polygon copied from the source file, on the same 200×200 artboard. Use them
 * wherever a single app is identified (app switcher, launcher tiles, palettes). The KitStak
 * lockup and two-bar mark in ../logo stay for the brand itself.
 *
 * Inline SVG so every app gets the icons from this package without serving its own copies.
 * The colours are the export's fixed Red and Pink, which read on light and dark surfaces alike.
 */
import * as React from 'react';

export type AppIconId = 'portal' | 'crm' | 'wms' | 'projects' | 'pulse';

const RED = '#C8102E';
const PINK = '#D65A6E';

type RectShape = readonly [x: number, y: number, width: number, height: number, fill: string];
/** A polygon from the source file, its `points` copied as written. */
type PolygonShape = readonly [points: string, fill: string];
type Shape = RectShape | PolygonShape;

const isPolygon = (shape: Shape): shape is PolygonShape => typeof shape[0] === 'string';

/** `offsetY` reproduces the `translate(0,-8)` group in the warehouse source file. */
const ICONS: Readonly<Record<AppIconId, { readonly offsetY: number; readonly shapes: readonly Shape[] }>> = {
  portal: {
    offsetY: 0,
    shapes: [
      [38, 56, 56, 38, RED],
      [106, 56, 56, 38, PINK],
      [38, 106, 56, 38, PINK],
      [106, 106, 56, 38, RED],
    ],
  },
  crm: {
    offsetY: 0,
    shapes: [
      [36, 50, 128, 26, RED],
      [56, 87, 88, 26, PINK],
      [76, 124, 48, 26, RED],
    ],
  },
  // Named "warehouse" in the brand export.
  wms: {
    offsetY: -8,
    shapes: [
      [34, 90, 132, 14, RED],
      [46, 62, 30, 28, PINK],
      [86, 70, 26, 20, PINK],
      [122, 58, 32, 32, PINK],
      [34, 144, 132, 14, RED],
      [44, 118, 36, 26, PINK],
      [90, 124, 28, 20, PINK],
      [128, 114, 26, 30, PINK],
    ],
  },
  projects: {
    offsetY: 0,
    shapes: [
      [38, 52, 80, 26, RED],
      [68, 87, 80, 26, PINK],
      [98, 122, 64, 26, RED],
    ],
  },
  // Two notched bars, red over pink.
  pulse: {
    offsetY: 0,
    shapes: [
      ['40,71 82,71 100,53 118,71 160,71 160,101 118,101 100,83 82,101 40,101', RED],
      ['40,117 82,117 100,99 118,117 160,117 160,147 118,147 100,129 82,147 40,147', PINK],
    ],
  },
};

export interface AppIconProps {
  readonly app: AppIconId;
  /** Width and height in px. The artwork sits inside its own padding, as supplied. */
  readonly size?: number;
  readonly className?: string;
}

/**
 * Where the artwork sits on the 200×200 artboard, across all five icons (x 34 to 166, y 50 to 150).
 * Use it as a view box to draw an icon without the file's padding, as the KitStak lockup does.
 */
export const APP_ICON_ARTWORK_BOX = { x: 34, y: 50, width: 132, height: 100 } as const;

/** The icon's shapes on the 200×200 artboard, for drawing inside another SVG. */
export function AppIconShapes({ app }: { readonly app: AppIconId }) {
  const icon = ICONS[app];
  return (
    <g transform={icon.offsetY === 0 ? undefined : `translate(0,${icon.offsetY})`}>
      {icon.shapes.map((shape) => {
        if (isPolygon(shape)) {
          const [points, fill] = shape;
          return <polygon key={points} points={points} fill={fill} />;
        }
        const [x, y, width, height, fill] = shape;
        return <rect key={`${x}-${y}-${width}`} x={x} y={y} width={width} height={height} fill={fill} />;
      })}
    </g>
  );
}

/** Decorative by default: pair it with the app's written name. */
export function AppIcon({ app, size = 24, className }: AppIconProps) {
  return (
    <svg aria-hidden viewBox="0 0 200 200" width={size} height={size} className={className} style={{ flexShrink: 0 }}>
      <AppIconShapes app={app} />
    </svg>
  );
}
