import { Logo as KitStakLogo, LogoMark, type LogoMarkProps, type LogoProps } from '@kitstak/ui/logo';

export { LogoMark };
export type { LogoMarkProps, LogoProps };

/** The KitStak lockup with the Projects product tag (shared @kitstak/ui logo). */
export function Logo({ product = 'Projects', ...props }: LogoProps) {
  return <KitStakLogo product={product} {...props} />;
}

/** The Projects app mark (three staggered bars, brand pack `kitstak-icon-projects.svg`). */
export function ProjectsMark({ size = 20, className }: { readonly size?: number; readonly className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 200 200" className={className}>
      <rect x="38" y="52" width="80" height="26" fill="#C8102E" />
      <rect x="68" y="87" width="80" height="26" fill="#D65A6E" />
      <rect x="98" y="122" width="64" height="26" fill="#C8102E" />
    </svg>
  );
}
