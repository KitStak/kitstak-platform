"use client";

import * as React from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const MAX_BADGE = 99;

export interface HeaderIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly label: string;
  readonly badge?: number;
  /** Animated dot (e.g. a background task is running). */
  readonly pulse?: boolean;
}

/** Round icon button in the indigo header, with a tooltip and optional count badge. */
export const HeaderIconButton = React.forwardRef<HTMLButtonElement, HeaderIconButtonProps>(
  ({ label, badge, pulse, className, children, ...props }, ref) => (
    <Tooltip content={label} side="bottom">
      <button
        ref={ref}
        type="button"
        className={cn(
          "relative flex h-8 w-8 items-center justify-center rounded-full text-white/75 outline-none transition-colors",
          "hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/50 data-[state=open]:bg-white/15 data-[state=open]:text-white",
          className,
        )}
        {...props}
      >
        {/* Named by content: sr-only label, then the visible badge, so the name contains the visible text. */}
        <span className="sr-only">{label}</span>
        {children}
        {badge ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#f04438] px-1 text-[9px] font-bold leading-none text-white ring-2 ring-nav">
            {badge > MAX_BADGE ? `${MAX_BADGE}+` : badge}
          </span>
        ) : null}
        {pulse && !badge ? <span className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-[#5fe3c0]" aria-hidden /> : null}
      </button>
    </Tooltip>
  ),
);
HeaderIconButton.displayName = "HeaderIconButton";
