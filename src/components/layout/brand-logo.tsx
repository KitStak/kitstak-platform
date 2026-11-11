import { BRAND_NAME } from "@/config/brand";

/** Brand palette (from the KitStak identity kit). Kept here so the mark renders identically everywhere. */
export const BRAND_COLORS = {
  crimson: "#C8102E",
  maroon: "#8F122C",
  rose: "#D6596B",
  navy: "#0A1628",
  cream: "#F3F0E7",
} as const;

/** "dark" = the mark sits on a navy/dark surface; "light" = on cream/white. */
export type BrandTone = "dark" | "light";

interface BrandMarkProps {
  readonly tone?: BrandTone;
  readonly size?: number;
  readonly className?: string;
}

/** The two-bar KitStak mark. Top bar is always crimson; the lower bar is maroon on dark, rose on light. */
export function BrandMark({ tone = "dark", size = 20, className }: BrandMarkProps) {
  const lower = tone === "dark" ? BRAND_COLORS.maroon : BRAND_COLORS.rose;
  return (
    <svg width={size} height={(size * 13) / 20} viewBox="0 0 20 13" aria-hidden className={className}>
      <rect x="0" y="0" width="20" height="5" fill={BRAND_COLORS.crimson} />
      <rect x="0" y="8" width="20" height="5" fill={lower} />
    </svg>
  );
}

interface BrandLogoProps {
  readonly tone?: BrandTone;
  /** Cap height of the wordmark in px; the mark scales with it. */
  readonly height?: number;
  readonly showProduct?: boolean;
  readonly className?: string;
  readonly wordmarkClassName?: string;
}

/** Mark + condensed uppercase wordmark, matching the KitStak logo lockup. */
export function BrandLogo({ tone = "dark", height = 20, showProduct = false, className, wordmarkClassName }: BrandLogoProps) {
  // "light" tone sits on theme surfaces, so it follows the theme (navy in light mode, cream in dark).
  const textColor = tone === "dark" ? BRAND_COLORS.cream : "var(--foreground)";
  return (
    <span className={`inline-flex items-center ${className ?? ""}`} style={{ gap: Math.round(height * 0.5) }}>
      <BrandMark tone={tone} size={Math.round(height * 1.0)} />
      <span
        className={`font-display uppercase leading-none ${wordmarkClassName ?? ""}`}
        style={{ color: textColor, fontSize: Math.round(height * 1.3), letterSpacing: "0.06em" }}
      >
        {BRAND_NAME}
      </span>
      {showProduct ? (
        <span
          className="rounded-[3px] px-1 py-px font-semibold uppercase leading-none tracking-widest"
          style={{
            fontSize: Math.max(9, Math.round(height * 0.45)),
            color: tone === "dark" ? "rgba(243,240,231,0.72)" : "var(--text-muted)",
            background: tone === "dark" ? "rgba(243,240,231,0.1)" : "var(--neutral-soft)",
          }}
        >
          WMS
        </span>
      ) : null}
    </span>
  );
}
