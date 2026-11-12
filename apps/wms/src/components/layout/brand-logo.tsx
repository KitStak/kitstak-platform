import { Logo, LogoMark } from '@kitstak/ui/logo';

/*
 * Compatibility shim: the KitStak marks are rendered by the shared @kitstak/ui/logo lockup
 * (bars + wordtype artwork) so WMS shows the exact same logo as CRM and the portal. The old
 * BrandMark/BrandLogo prop shapes are kept so existing call sites (and printouts) keep working.
 */

/** Brand palette (from the KitStak identity kit). Kept for printouts/labels that need literals. */
export const BRAND_COLORS = {
  crimson: '#C8102E',
  maroon: '#8F122C',
  rose: '#D6596B',
  navy: '#0A1628',
  cream: '#F3F0E7',
} as const;

/** "dark" = the mark sits on a navy/dark surface; "light" = on cream/white. */
export type BrandTone = 'dark' | 'light';

interface BrandMarkProps {
  readonly tone?: BrandTone;
  readonly size?: number;
  readonly className?: string;
}

/** The two-bar KitStak mark (shared geometry: red over oxblood, 10:5 viewBox). */
export function BrandMark({ size = 20, className }: BrandMarkProps) {
  // The legacy mark rendered size × (size × 13/20); the shared mark renders size × (size / 2).
  // Scale by 1.3 so the stacked bars keep the same rendered height (optical weight).
  return <LogoMark size={Math.round(size * 1.3)} className={className} />;
}

interface BrandLogoProps {
  readonly tone?: BrandTone;
  /** Cap height of the wordmark in px; the lockup scales with it. */
  readonly height?: number;
  readonly showProduct?: boolean;
  readonly className?: string;
  readonly wordmarkClassName?: string;
}

/** The KitStak lockup (bars + wordtype artwork), with the WMS product tag when requested. */
export function BrandLogo({ tone = 'dark', height = 20, showProduct = false, className }: BrandLogoProps) {
  return (
    <Logo
      size={Math.round(height / 0.8)}
      product={showProduct ? 'WMS' : undefined}
      tone={tone === 'dark' ? 'inverse' : 'auto'}
      className={className}
    />
  );
}
