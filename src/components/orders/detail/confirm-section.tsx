import * as React from "react";
import type { TimelineEvent } from "@/server/repositories/orders";
import { cn, formatDateTime } from "@/lib/utils";
import { SectionCard } from "./section-card";

export interface ConfirmSectionProps {
  timeline: TimelineEvent[];
  footer?: React.ReactNode;
}

/** Vertical dot-and-line timeline of synthesized order events. */
export function ConfirmSection({ timeline, footer }: ConfirmSectionProps) {
  return (
    <SectionCard
      stepLabel="Step 6"
      title="Confirm"
      helper="Full event history for this order, from creation through delivery."
      footer={footer}
    >
      <ol className="ml-1">
        {timeline.map((event, idx) => {
          const isLast = idx === timeline.length - 1;
          return (
            <li key={event.label} className="relative flex gap-3 pb-5 last:pb-0">
              {!isLast ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-[5px] top-4 h-full w-px",
                    event.done && timeline[idx + 1]?.done ? "bg-success/40" : "bg-border"
                  )}
                />
              ) : null}
              <span
                aria-hidden
                className={cn(
                  "relative mt-1 h-[11px] w-[11px] shrink-0 rounded-full border-2",
                  event.done
                    ? "border-success bg-success"
                    : "border-border-strong bg-surface"
                )}
              />
              <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                <span
                  className={cn(
                    "text-[13px]",
                    event.done ? "font-medium text-foreground" : "text-faint"
                  )}
                >
                  {event.label}
                </span>
                <span
                  className={cn(
                    "whitespace-nowrap text-[12px] tabular-nums",
                    event.done ? "text-secondary" : "text-faint"
                  )}
                >
                  {event.done && event.at ? formatDateTime(event.at) : "Pending"}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </SectionCard>
  );
}
