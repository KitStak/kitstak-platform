import { Logo as KitStakLogo, LogoMark, type LogoMarkProps, type LogoProps } from '@kitstak/ui/logo';

export { LogoMark };
export type { LogoMarkProps, LogoProps };

/** The KitStak lockup with the Crew icon and product tag (shared @kitstak/ui logo). */
export function Logo({ product = 'Crew', app = 'crew', ...props }: LogoProps) {
  return <KitStakLogo product={product} app={app} {...props} />;
}

/**
 * The Crew app mark, shape for shape from the brand pack (`public/brand/kitstak-icon-crew.svg`):
 * a pink head over red shoulders.
 */
export function CrewMark({ size = 20, className }: { readonly size?: number; readonly className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 200 200" className={className}>
      <polygon points="73.21,50 126.79,50 100,96.43" fill="#D65A6E" />
      <polygon points="46.43,150 100,103.57 153.57,150 122.66,150 100,130.36 77.34,150" fill="#C8102E" />
    </svg>
  );
}
