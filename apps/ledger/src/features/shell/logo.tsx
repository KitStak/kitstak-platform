import { Logo as KitStakLogo, LogoMark, type LogoMarkProps, type LogoProps } from '@kitstak/ui/logo';

export { LogoMark };
export type { LogoMarkProps, LogoProps };

/** The KitStak lockup with the Ledger icon and product tag (shared @kitstak/ui logo). */
export function Logo({ product = 'Ledger', app = 'ledger', ...props }: LogoProps) {
  return <KitStakLogo product={product} app={app} {...props} />;
}

/**
 * The Ledger app mark, shape for shape from the brand pack (`public/brand/kitstak-icon-ledger.svg`):
 * a T, the red bar over the pink stem.
 */
export function LedgerMark({ size = 20, className }: { readonly size?: number; readonly className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 200 200" className={className}>
      <rect x="46" y="50" width="108" height="26" fill="#C8102E" />
      <rect x="87" y="87" width="26" height="63" fill="#D65A6E" />
    </svg>
  );
}
