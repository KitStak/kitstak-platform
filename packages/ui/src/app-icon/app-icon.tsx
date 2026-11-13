/**
 * KitStak app icons, built 1:1 from the supplied brand export (KitStak Branding/icons/svg): each
 * shape below is a rectangle copied from the source file, on the same 200×200 artboard. Use them
 * wherever a single app is identified (app switcher, launcher tiles, palettes). The KitStak
 * lockup and two-bar mark in ../logo stay for the brand itself.
 *
 * Inline SVG so every app gets the icons from this package without serving its own copies.
 * The colours are the export's fixed Red and Pink, which read on light and dark surfaces alike.
 */
import * as React from 'react';

export type AppIconId = 'portal' | 'crm' | 'wms' | 'projects';

const RED = '#C8102E';
const PINK = '#D65A6E';

type Shape = readonly [x: number, y: number, width: number, height: number, fill: string];

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
};

export interface AppIconProps {
  readonly app: AppIconId;
  /** Width and height in px. The artwork sits inside its own padding, as supplied. */
  readonly size?: number;
  readonly className?: string;
}

/** Decorative by default: pair it with the app's written name. */
export function AppIcon({ app, size = 24, className }: AppIconProps) {
  const icon = ICONS[app];
  return (
    <svg aria-hidden viewBox="0 0 200 200" width={size} height={size} className={className} style={{ flexShrink: 0 }}>
      <g transform={icon.offsetY === 0 ? undefined : `translate(0,${icon.offsetY})`}>
        {icon.shapes.map(([x, y, width, height, fill]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={width} height={height} fill={fill} />
        ))}
      </g>
    </svg>
  );
}
