"use client";

import { cn } from "@/lib/utils";
import { formatDifference } from "@/lib/grid-defs/counts/count-math";
import { differenceTone } from "@/lib/status-colors";

/** Coloured "% Difference" pill: red-orange below 0, green above, grey at 0, dash when not counted. */
export function DifferenceBadge({ value, suffix = "%", className }: { readonly value: number | null | undefined; readonly suffix?: string; readonly className?: string }) {
  if (value === null || value === undefined) return <span className="text-faint">—</span>;
  const tone = differenceTone(value);
  return (
    <span
      data-difference={value}
      style={{ backgroundColor: tone.bg, color: tone.fg }}
      className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", className)}
    >
      {formatDifference(value)}
      {suffix}
    </span>
  );
}

/** Signed unit delta "+3" / "−2" with the same tones. */
export function DeltaBadge({ value }: { readonly value: number }) {
  const tone = differenceTone(value);
  return (
    <span style={{ backgroundColor: tone.bg, color: tone.fg }} className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums">
      {value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0"}
    </span>
  );
}
