/**
 * KitStak brand marks, built 1:1 from the supplied brand files (apps/crm/public/brand/source).
 *
 *   Mark     two stacked bars (5:1, gap = half a bar): KitStak Red over Oxblood.
 *   Lockup   4:1 bars (gap 0.6 bar) + the KITSTAK wordtype. The lower bar is KitStak Red at 70%,
 *            which composites to Oxblood (#8F122C) on navy and to #D55366 on cream, exactly as in
 *            the supplied light and dark lockups.
 *   App      with `app`, the lockup shows that app's icon (../app-icon) in place of the bars, so
 *            each app's header reads [app icon] KITSTAK | APP.
 *
 * The wordtype letterforms are the supplied artwork used as an alpha mask (each app serves
 * public/brand/kitstak-wordtype.png), painted with --logo-ink so they are navy on light surfaces
 * and cream on dark ones with no colour fringing. Styling lives in ./logo.css next to this file.
 */
import * as React from 'react';
import { APP_ICON_ARTWORK_BOX, AppIconShapes, type AppIconId } from '../app-icon/app-icon';
import './logo.css';

/** Minimal class joiner (the shared package has no tailwind-merge dependency). */
function cn(...classes: ReadonlyArray<string | false | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** Lockup geometry in source pixels (from the 2000×600 brand files, cropped to the artwork). */
const LOCKUP = {
  width: 1144,
  height: 217,
  barWidth: 200,
  barHeight: 50,
  topBarY: 64,
  bottomBarY: 144,
  textX: 312,
  textWidth: 832,
} as const;

/**
 * The app lockup: the app's icon in place of the bars, its artwork as tall as the wordtype and the
 * same gap before the letters as the bars have. Same source pixels as LOCKUP.
 */
const APP_ICON_WIDTH = Math.round((LOCKUP.height * APP_ICON_ARTWORK_BOX.width) / APP_ICON_ARTWORK_BOX.height);
const APP_LOCKUP = {
  height: LOCKUP.height,
  iconWidth: APP_ICON_WIDTH,
  textX: APP_ICON_WIDTH + (LOCKUP.textX - LOCKUP.barWidth),
  textWidth: LOCKUP.textWidth,
  width: APP_ICON_WIDTH + (LOCKUP.textX - LOCKUP.barWidth) + LOCKUP.textWidth,
} as const;

export interface LogoMarkProps {
  readonly size?: number;
  readonly className?: string;
}

/** The KitStak mark on its own (app icon geometry). */
export function LogoMark({ size = 28, className }: LogoMarkProps) {
  return (
    <svg aria-hidden viewBox="0 0 10 5" width={size} height={size / 2} className={cn('shrink-0', className)}>
      <rect x="0" y="0" width="10" height="2" fill="var(--brand-red)" />
      <rect x="0" y="3" width="10" height="2" fill="var(--brand-oxblood)" />
    </svg>
  );
}

export interface LogoProps extends LogoMarkProps {
  /** Product tag after the lockup, e.g. "CRM". Each app passes its own; omit for the bare lockup. */
  readonly product?: string;
  /** `inverse` forces the cream wordtype for dark brand surfaces regardless of theme. */
  readonly tone?: 'auto' | 'inverse';
  /** Draws this app's icon in place of the KitStak bars. Each app passes its own; omit for the bars. */
  readonly app?: AppIconId;
}

/** The two KitStak bars, drawn in LOCKUP source pixels. */
function LockupBars() {
  return (
    <>
      <rect x="0" y={LOCKUP.topBarY} width={LOCKUP.barWidth} height={LOCKUP.barHeight} fill="var(--brand-red)" />
      <rect
        x="0"
        y={LOCKUP.bottomBarY}
        width={LOCKUP.barWidth}
        height={LOCKUP.barHeight}
        fill="var(--brand-red)"
        fillOpacity="0.7"
      />
    </>
  );
}

/** The app's icon artwork, cropped to its shapes and as tall as the wordtype, in APP_LOCKUP pixels. */
function LockupAppIcon({ app }: { readonly app: AppIconId }) {
  const box = APP_ICON_ARTWORK_BOX;
  return (
    <svg x="0" y="0" width={APP_LOCKUP.iconWidth} height={APP_LOCKUP.height} viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}>
      <AppIconShapes app={app} />
    </svg>
  );
}

/** The KitStak lockup. `size` is the visual weight used across the apps (≈ lockup height ÷ 0.8). */
export function Logo({ size = 28, product, tone = 'auto', app, className }: LogoProps) {
  const geometry = app ? APP_LOCKUP : LOCKUP;
  const height = Math.round(size * 0.8);
  const width = (height * geometry.width) / geometry.height;
  return (
    <span className={cn('ks-logo inline-flex items-center', tone === 'inverse' && 'ks-logo-inverse', className)}>
      <span role="img" aria-label="KitStak" className="relative block shrink-0" style={{ width, height }}>
        <svg
          aria-hidden
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          className="absolute inset-0 size-full"
          preserveAspectRatio="none"
        >
          {app ? <LockupAppIcon app={app} /> : <LockupBars />}
        </svg>
        <span
          aria-hidden
          className="ks-wordtype absolute top-0 h-full"
          style={{
            left: `${(geometry.textX / geometry.width) * 100}%`,
            width: `${(geometry.textWidth / geometry.width) * 100}%`,
          }}
        />
      </span>
      {product ? (
        <span
          className="ks-logo-product ml-2.5 border-l pl-2.5 font-heading font-semibold tracking-[0.14em] uppercase"
          style={{ fontSize: Math.max(11, Math.round(height * 0.52)), lineHeight: `${height}px` }}
        >
          {product}
        </span>
      ) : null}
    </span>
  );
}
