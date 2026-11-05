import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[11px] text-faint">
      <Link href="/dashboard" className="transition-colors hover:text-secondary">
        Home
      </Link>
      {items.map((item) => (
        <React.Fragment key={item.label}>
          <ChevronRight className="h-3 w-3" aria-hidden />
          {item.href ? (
            <Link href={item.href} className="transition-colors hover:text-secondary">
              {item.label}
            </Link>
          ) : (
            <span className="text-secondary">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

export function PageHeader({
  breadcrumbs,
  title,
  helper,
  actions,
  className,
}: {
  breadcrumbs: Crumb[];
  title: string;
  helper?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-6 pt-3", className)}>
      <Breadcrumbs items={breadcrumbs} />
      <div className="mt-1.5 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">
          {title}
        </h1>
        {helper ? (
          <p className="hidden flex-1 text-center text-[11px] text-faint lg:block">
            {helper}
          </p>
        ) : null}
        <div className="flex items-center gap-2">{actions}</div>
      </div>
    </div>
  );
}

export function UnderlineTabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("flex items-center gap-6 border-b border-border px-6", className)}
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 pb-2 pt-2.5 text-[12px] font-semibold uppercase tracking-[0.02em] transition-colors",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-faint hover:border-border-strong hover:text-secondary"
            )}
          >
            {tab.label}
            {typeof tab.count === "number" ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[10px] tabular-nums",
                  isActive ? "bg-primary-soft text-primary" : "bg-neutral-soft text-neutral"
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
