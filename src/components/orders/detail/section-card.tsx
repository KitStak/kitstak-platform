import * as React from "react";
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
          <p className="hidden max-w-sm pb-0.5 text-right text-[11px] leading-4 text-faint md:block">
            {helper}
          </p>
        ) : null}
      </div>
      <div className="px-5 py-4">{children}</div>
      {footer ? (
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}

export interface ReadFieldProps {
  label: string;
  value: React.ReactNode;
  required?: boolean;
  mono?: boolean;
  className?: string;
}

/** Read-only field styled like a disabled input (Logiwa edit-wizard look). */
export function ReadField({ label, value, required, mono, className }: ReadFieldProps) {
  const isEmpty = value === null || value === undefined || value === "" || value === "—";
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[12px] font-semibold text-body">
        {label}
        {required ? <span className="text-danger">*</span> : null}
      </span>
      <div
        className={cn(
          "flex h-8 items-center rounded-md border border-border-strong/50 bg-surface-sunken px-2.5 text-[13px]",
          isEmpty ? "text-faint" : "text-body",
          mono && "font-mono text-[12px] tracking-tight"
        )}
      >
        <span className="truncate">{isEmpty ? "—" : value}</span>
      </div>
    </div>
  );
}

/** Two-column responsive field grid used by the read-only wizard sections. */
export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">{children}</div>;
}
