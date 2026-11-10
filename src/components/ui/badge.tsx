import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva("inline-flex items-center gap-1 whitespace-nowrap font-semibold", {
  variants: {
    tone: {
      neutral: "bg-neutral-soft text-neutral",
      primary: "bg-primary-soft text-primary",
      success: "bg-success-soft text-success",
      warning: "bg-warning-soft text-warning",
      danger: "bg-danger-soft text-danger",
      info: "bg-info-soft text-info",
      solid: "bg-primary text-white",
      outline: "border border-border-strong bg-surface text-secondary",
    },
    size: {
      sm: "rounded px-1.5 py-px text-[10px] leading-4",
      md: "rounded-md px-2 py-0.5 text-[11px] leading-4",
    },
    shape: { rounded: "", pill: "rounded-full" },
  },
  defaultVariants: { tone: "neutral", size: "md", shape: "rounded" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  readonly icon?: React.ComponentType<{ className?: string }>;
}

/** Generic label/count badge. Statuses use `StatusPill` instead. */
export function Badge({ className, tone, size, shape, icon: Icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size, shape }), className)} {...props}>
      {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
      {children}
    </span>
  );
}
