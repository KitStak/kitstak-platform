'use client';

/**
 * Lifts the shared toast viewport (bottom-right) above a station's sticky action footer while
 * the station screen is mounted, so a toast never covers "Complete packing" or "Complete
 * return" (REQ-12). Scoped: the rule only exists while this component renders. The shared
 * Toaster would ideally expose an offset variable; see docs/requests/stations-returns.md.
 */
export const STATION_FOOTER_TOAST_OFFSET_PX = 88;

export function StickyFooterToastOffset({ px = STATION_FOOTER_TOAST_OFFSET_PX }: { readonly px?: number }) {
  // The shared toaster now stacks top centre below the header, clear of sticky footers; the
  // variable is kept for pages that still want to reserve footer room.
  return <style>{`:root { --toast-offset-bottom: ${px}px; }`}</style>;
}
