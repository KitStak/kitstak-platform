import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface StatusScreenProps {
  /** Big code shown above the title ("404", "403"). */
  readonly code?: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly tone?: "neutral" | "danger" | "warning";
  readonly title: string;
  readonly description: React.ReactNode;
  readonly actions?: React.ReactNode;
  readonly className?: string;
}

const TONE: Readonly<Record<NonNullable<StatusScreenProps["tone"]>, string>> = {
  neutral: "bg-primary-soft text-primary",
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
};

/** Full-area status page used by 404 / 403 / error boundaries. */
export function StatusScreen({ code, icon: Icon, tone = "neutral", title, description, actions, className }: StatusScreenProps) {
  return (
    <div className={cn("flex flex-1 items-center justify-center px-6 py-16", className)}>
      <div className="flex max-w-[480px] flex-col items-center text-center">
        <span className={cn("flex h-14 w-14 items-center justify-center rounded-2xl", TONE[tone])}>
          <Icon className="h-7 w-7" aria-hidden />
        </span>
        {code ? <p className="mt-4 text-[12px] font-bold uppercase tracking-[0.18em] text-faint">Error {code}</p> : null}
        <h1 className="mt-1 text-[24px] font-bold tracking-tight text-foreground">{title}</h1>
        <div className="mt-2 text-[13px] leading-5 text-secondary">{description}</div>
        {actions ? <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function HomeLink({ label = "Go to Dashboard" }: { readonly label?: string }) {
  return (
    <Link href="/dashboard" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-[13px] font-medium text-white shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40">
      {label}
    </Link>
  );
}

/** The denied path from `?from=` when it is a safe, same-origin app path. */
export function deniedPath(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.length > 200) return null;
  return raw.split(/[?#]/)[0] ?? null;
}
