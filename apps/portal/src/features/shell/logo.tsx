import { cn } from '@/components/ui/cn';

/*
 * KitStak brand marks (copied from apps/crm/src/features/shell/logo.tsx — the lockup is a
 * shared brand asset; portal defaults the product tag to "Portal").
 */

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

export interface LogoMarkProps {
  readonly size?: number;
  readonly className?: string;
}

/** The KitStak mark on its own (two stacked bars). */
export function LogoMark({ size = 28, className }: LogoMarkProps) {
  return (
    <svg aria-hidden viewBox="0 0 10 5" width={size} height={size / 2} className={cn('shrink-0', className)}>
      <rect x="0" y="0" width="10" height="2" fill="var(--brand-red)" />
      <rect x="0" y="3" width="10" height="2" fill="var(--brand-oxblood)" />
    </svg>
  );
}

export interface LogoProps extends LogoMarkProps {
  /** Optional product tag after the lockup, e.g. "Portal". */
  readonly product?: string;
  /** `inverse` forces the cream wordtype for dark brand surfaces regardless of theme. */
  readonly tone?: 'auto' | 'inverse';
}

/** The KitStak lockup. `size` is the visual weight used across the app (≈ lockup height ÷ 0.8). */
export function Logo({ size = 28, product = 'Portal', tone = 'auto', className }: LogoProps) {
  const height = Math.round(size * 0.8);
  const width = (height * LOCKUP.width) / LOCKUP.height;
  return (
    <span
      className={cn('ks-logo inline-flex items-center', tone === 'inverse' && 'ks-logo-inverse', className)}
    >
      <span role="img" aria-label="KitStak" className="relative block shrink-0" style={{ width, height }}>
        <svg
          aria-hidden
          viewBox={`0 0 ${LOCKUP.width} ${LOCKUP.height}`}
          className="absolute inset-0 size-full"
          preserveAspectRatio="none"
        >
          <rect
            x="0"
            y={LOCKUP.topBarY}
            width={LOCKUP.barWidth}
            height={LOCKUP.barHeight}
            fill="var(--brand-red)"
          />
          <rect
            x="0"
            y={LOCKUP.bottomBarY}
            width={LOCKUP.barWidth}
            height={LOCKUP.barHeight}
            fill="var(--brand-red)"
            fillOpacity="0.7"
          />
        </svg>
        <span
          aria-hidden
          className="ks-wordtype absolute top-0 h-full"
          style={{
            left: `${(LOCKUP.textX / LOCKUP.width) * 100}%`,
            width: `${(LOCKUP.textWidth / LOCKUP.width) * 100}%`,
          }}
        />
      </span>
      {product ? (
        <span
          className="ks-logo-product ml-2.5 hidden border-l pl-2.5 font-heading font-semibold tracking-[0.14em] uppercase sm:block"
          style={{ fontSize: Math.max(11, Math.round(height * 0.52)), lineHeight: `${height}px` }}
        >
          {product}
        </span>
      ) : null}
    </span>
  );
}
