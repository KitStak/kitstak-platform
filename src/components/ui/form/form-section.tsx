"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FormSectionProps {
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly action?: React.ReactNode;
  /** Collapsible sections start open unless `defaultOpen` is false. */
  readonly collapsible?: boolean;
  readonly defaultOpen?: boolean;
  readonly className?: string;
  readonly children: React.ReactNode;
}

export function FormSection({ title, description, action, collapsible, defaultOpen = true, className, children }: FormSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const contentId = React.useId();
  const heading = <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>;
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-border pb-2">
        <div className="min-w-0">
          {collapsible ? (
            <button type="button" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
              <ChevronDown className={cn("h-4 w-4 text-secondary transition-transform", !open && "-rotate-90")} aria-hidden />
              {heading}
            </button>
          ) : (
            heading
          )}
          {description ? <p className="mt-0.5 text-[12px] leading-4 text-secondary">{description}</p> : null}
        </div>
        {action}
      </div>
      <div id={contentId} hidden={collapsible ? !open : undefined}>
        {children}
      </div>
    </section>
  );
}
