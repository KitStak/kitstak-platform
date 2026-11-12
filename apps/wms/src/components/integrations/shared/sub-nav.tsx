"use client";
/**
 * Section sub-navigation for Channel Logs and Items for Review (M12). From 1024px up it is the
 * left VerticalNav; below that it collapses into a horizontally scrollable pill row above the grid,
 * so a 768px tablet gives the grid the full content width instead of losing ~240px to the nav.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { VerticalNav, activePageTab, type VerticalNavItem } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export function SubNavLayout({ items, ariaLabel, asideClassName, navClassName, children }: {
  readonly items: readonly VerticalNavItem[];
  readonly ariaLabel: string;
  readonly asideClassName?: string;
  readonly navClassName?: string;
  readonly children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = activePageTab(items.flatMap((i) => (i.href ? [{ href: i.href, label: String(i.label) }] : [])), pathname);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col px-4 pb-4 lg:flex-row lg:pl-6 lg:pr-0">
      <aside className={cn("hidden shrink-0 lg:block", asideClassName ?? "w-52")}>
        <VerticalNav ariaLabel={ariaLabel} items={items} className={navClassName} />
      </aside>
      <nav aria-label={ariaLabel} className="mb-3 flex flex-wrap gap-1.5 lg:hidden">
        {items.map((item) => {
          const isActive = item.href === active;
          return item.href ? (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                isActive ? "border-transparent bg-neutral-soft font-semibold text-foreground" : "border-border text-secondary hover:bg-surface-sunken hover:text-body",
              )}
            >
              {item.label}
              {typeof item.count === "number" ? <span className="rounded-full bg-surface-sunken px-1.5 text-2xs tabular-nums">{item.count}</span> : null}
            </Link>
          ) : null;
        })}
      </nav>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</section>
    </div>
  );
}
