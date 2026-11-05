import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface shadow-xs",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  info,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  info?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <div>
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
          {title}
          {info ? <Info className="h-3.5 w-3.5 text-faint" aria-hidden /> : null}
        </h3>
        {description ? (
          <p className="mt-0.5 text-[12px] leading-4 text-faint">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("ks-skeleton", className)} aria-hidden />;
}
