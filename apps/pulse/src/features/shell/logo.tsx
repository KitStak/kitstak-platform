import { Logo as KitStakLogo, LogoMark, type LogoMarkProps, type LogoProps } from '@kitstak/ui/logo';

export { LogoMark };
export type { LogoMarkProps, LogoProps };

/** The KitStak lockup with the Pulse product tag (shared @kitstak/ui logo). */
export function Logo({ product = 'Pulse', ...props }: LogoProps) {
  return <KitStakLogo product={product} {...props} />;
}

/**
 * The Pulse app mark, rect for rect from the brand pack (`public/brand/kitstak-icon-pulse.svg`):
 * a full bar over a meter. The faded track is the whole job, the solid part is what is left.
 */
export function PulseMark({ size = 20, className }: { readonly size?: number; readonly className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 200 200" className={className}>
      <rect x="40" y="62" width="120" height="30" fill="#C8102E" />
      <rect x="40" y="108" width="120" height="30" fill="#D65A6E" opacity="0.35" />
      <rect x="40" y="108" width="84" height="30" fill="#D65A6E" />
    </svg>
  );
}
