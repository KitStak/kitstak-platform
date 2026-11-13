/**
 * The supplied app icons (KitStak Branding/icons/svg, copied unchanged to public/brand/apps).
 * Use these wherever a single app is being identified: menus, product pages, cards, the wizard.
 * The KitStak logo and the two-bar mark stay for the brand itself and for the bundle.
 */
export type AppId = 'crm' | 'wms' | 'projects';

/** The brand export names the WMS icon "warehouse". */
const ICON_FILE: Readonly<Record<AppId, string>> = {
  crm: '/brand/apps/kitstak-icon-crm.svg',
  wms: '/brand/apps/kitstak-icon-warehouse.svg',
  projects: '/brand/apps/kitstak-icon-projects.svg',
};

interface AppIconProps {
  readonly app: AppId;
  /** Width and height in px. The artwork sits inside its own padding, as supplied. */
  readonly size?: number;
  readonly className?: string;
}

/** Decorative: the app's name is always written beside it. */
export function AppIcon({ app, size = 32, className }: AppIconProps) {
  return (
    <img
      src={ICON_FILE[app]}
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={className}
      style={{ flex: 'none' }}
    />
  );
}
