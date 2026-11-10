/**
 * Record detail header: back link, code as H1, status pill, meta line and actions.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StatusDomain } from "@/lib/status-colors";
import { StatusPill } from "@/components/ui/status-pill";

export interface DetailHeaderProps {
  readonly title: React.ReactNode;
  readonly backHref?: string;
  readonly backLabel?: string;
  readonly status?: string | null;
  readonly statusDomain?: StatusDomain;
  /** Secondary line (client, warehouse, created date …). */
  readonly meta?: React.ReactNode;
  readonly badges?: React.ReactNode;
  readonly actions?: React.ReactNode;
  readonly className?: string;
}

export function DetailHeader({ title, backHref, backLabel = "Back", status, statusDomain, meta, badges, actions, className }: DetailHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-2 px-6 pt-5 pb-4", className)}>
      {backHref ? (
        <Link href={backHref} className="inline-flex w-fit items-center gap-1 text-[12px] font-semibold text-secondary transition-colors hover:text-primary focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {backLabel}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[22px] font-semibold tracking-tight text-foreground">{title}</h1>
            {status ? <StatusPill status={status} domain={statusDomain} /> : null}
            {badges}
          </div>
          {meta ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-secondary">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
