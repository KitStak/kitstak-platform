import * as React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "./card";

export { Skeleton };

/** Paragraph placeholder; the last line is shorter. */
export function SkeletonText({ lines = 3, className }: { readonly lines?: number; readonly className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** Grid placeholder: header + rows, used by pages before data arrives. */
export function SkeletonTable({ rows = 8, columns = 6, className }: { readonly rows?: number; readonly columns?: number; readonly className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("overflow-hidden rounded-lg border border-border bg-surface", className)}>
      <div className="flex gap-4 border-b border-border bg-surface-sunken px-4 py-3">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-2.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-10 items-center gap-4 border-b border-border px-4 last:border-b-0">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn("h-3 flex-1", c === 0 && "max-w-[120px]")} />
          ))}
        </div>
      ))}
    </div>
  );
}
