/**
 * Branded loading state. Shows the brand pack's animated WMS loader
 * (the SVG stops animating for people who prefer reduced motion).
 * `variant="company"` shows the KitStak company loader, used on sign-in and cross-app handoff screens.
 */
export function BrandLoader({
  label = 'Loading',
  size = 64,
  variant = 'app',
  fill = true,
}: {
  readonly label?: string;
  readonly size?: number;
  readonly variant?: 'app' | 'company';
  readonly fill?: boolean;
}) {
  const src = variant === 'company' ? '/brand/kitstak-loader-kitstak.svg' : '/brand/kitstak-loader-wms.svg';
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        fill
          ? 'flex h-full min-h-[240px] w-full flex-1 flex-col items-center justify-center gap-3'
          : 'flex flex-col items-center justify-center gap-3'
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- animated SVG must stay an <img> to keep its animation */}
      <img src={src} width={size} height={size} alt="Loading" />
      <span className="text-sm text-fg-muted">{label}…</span>
    </div>
  );
}
