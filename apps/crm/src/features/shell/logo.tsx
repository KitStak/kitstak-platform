import { Logo as KitStakLogo, LogoMark, type LogoMarkProps, type LogoProps } from '@kitstak/ui/logo';

/*
 * KitStak brand marks now live in packages/ui/src/logo (shared with portal and WMS). This file
 * is a thin wrapper that pins the CRM product tag so existing call sites keep working.
 */

export { LogoMark };
export type { LogoMarkProps, LogoProps };

/** The KitStak lockup with the CRM icon and product tag by default. */
export function Logo({ product = 'CRM', app = 'crm', ...props }: LogoProps) {
  return <KitStakLogo product={product} app={app} {...props} />;
}
