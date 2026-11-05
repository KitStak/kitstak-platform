import * as React from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export interface SectionCardProps {
  stepLabel: string;
  title: string;
  helper?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

/** Main section card: "Step N / Title" header with right-aligned helper text. */
export function SectionCard({
  stepLabel,
  title,
  helper,
  children,
  footer,
  className,
}: SectionCardProps) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex items-end justify-between gap-4 border-b border-border px-5 pb-3 pt-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">
            {stepLabel}
          </p>
          <h2 className="mt-0.5 text-[15px] font-semibold text-foreground">{title}</h2>
        </div>
        {helper ? (
          <p className="hidden max-w-[380px] pb-0.5 text-right text-[11px] leading-4 text-faint md:block">
            {helper}
          </p>
        ) : null}
      </div>
      <div className="px-5 py-4">{children}</div>
      {footer ? (
        /*
          Sticky action bar: pins to the bottom of the page scroll container
          while the card is in view, so the primary CTA is never clipped at
          short viewport heights (12px/24px padding, hairline top border,
          opaque card surface so content scrolls beneath it).
        */
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 rounded-b-lg border-t border-border bg-surface px-6 py-3">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}

export type ReadFieldAffordance = "select" | "date";

export interface ReadFieldProps {
  label: string;
  value: React.ReactNode;
  required?: boolean;
  mono?: boolean;
  /** Shown in faint text when the value is empty, instead of an em dash. */
  placeholder?: string;
  /** Renders a trailing chevron ("select") or calendar ("date") affordance. */
  affordance?: ReadFieldAffordance;
  className?: string;
}

/** Read-only field styled like a disabled input (Logiwa edit-wizard look). */
export function ReadField({
  label,
  value,
  required,
  mono,
  placeholder,
  affordance,
  className,
}: ReadFieldProps) {
  const isEmpty = value === null || value === undefined || value === "" || value === "—";
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[12px] font-medium text-body">
        {label}
        {required ? <span className="text-danger">*</span> : null}
      </span>
      <div
        className={cn(
          "relative flex h-9 items-center rounded-md border border-border-strong/50 bg-surface-sunken px-2.5 text-[13px]",
          isEmpty ? "text-faint" : "text-body",
          mono && "font-mono text-[12px] tracking-tight",
          affordance && "pr-9"
        )}
      >
        <span className="truncate">{isEmpty ? (placeholder ?? "—") : value}</span>
        {affordance ? (
          <span
            aria-hidden
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint"
          >
            {affordance === "select" ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <CalendarDays className="h-4 w-4" />
            )}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Two-column responsive field grid used by the read-only wizard sections. */
export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">{children}</div>;
}
