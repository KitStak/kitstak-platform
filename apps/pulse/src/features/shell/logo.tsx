import { Logo as KitStakLogo, LogoMark, type LogoMarkProps, type LogoProps } from '@kitstak/ui/logo';

export { LogoMark };
export type { LogoMarkProps, LogoProps };

/** The KitStak lockup with the Pulse icon and product tag (shared @kitstak/ui logo). */
export function Logo({ product = 'Pulse', app = 'pulse', ...props }: LogoProps) {
  return <KitStakLogo product={product} app={app} {...props} />;
}

/**
 * The Pulse app mark, shape for shape from the brand pack (`public/brand/kitstak-icon-pulse.svg`):
 * two notched bars, red over pink.
 */
export function PulseMark({ size = 20, className }: { readonly size?: number; readonly className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 200 200" className={className}>
      <polygon points="40,71 82,71 100,53 118,71 160,71 160,101 118,101 100,83 82,101 40,101" fill="#C8102E" />
      <polygon points="40,117 82,117 100,99 118,117 160,117 160,147 118,147 100,129 82,147 40,147" fill="#D65A6E" />
    </svg>
  );
}
