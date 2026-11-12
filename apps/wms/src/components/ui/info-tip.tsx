"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, type TooltipProps } from "./tooltip";

/** Small (i) icon with an explanatory tooltip, keyboard focusable. */
export function InfoTip({ content, label = "More information", side = "top", className }: { readonly content: React.ReactNode; readonly label?: string; readonly side?: TooltipProps["side"]; readonly className?: string }) {
  return (
    <Tooltip content={content} side={side}>
      {/* Hover/focus reveals the tip; a click has nothing to do by design (dead-click audit opt-out). */}
      <button
        type="button"
        data-audit-skip=""
        aria-label={label}
        className={cn(
          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:text-secondary focus-visible:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30",
          className
        )}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
    </Tooltip>
  );
}
