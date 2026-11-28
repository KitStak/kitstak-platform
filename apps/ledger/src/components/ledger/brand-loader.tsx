/** Branded loading state (brand pack animated Ledger loader; the SVG stops for reduced motion). */
export function BrandLoader({ label = 'Loading', size = 56 }: { readonly label?: string; readonly size?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex h-full min-h-[240px] w-full flex-col items-center justify-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- animated SVG must stay an <img> to keep its CSS animation */}
      <img src="/brand/kitstak-loader-ledger.svg" width={size} height={size} alt="" />
      <span className="text-sm text-fg-muted">{label}</span>
    </div>
  );
}
