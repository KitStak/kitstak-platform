"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { breadcrumbsFor, type Crumb } from "@/config/route-registry";
import { cn } from "@/lib/utils";

export type { Crumb };

/** `Home › …items`. "Home" and crumbs with `href` link; the rest are plain text. */
export function Breadcrumbs({ items, className }: { readonly items: readonly Crumb[]; readonly className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("text-[11px] text-secondary", className)}>
      <ol className="flex flex-wrap items-center gap-1">
        <li>
          <Link href="/dashboard" className="rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">Home</Link>
        </li>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3" aria-hidden />
              {item.href && !last ? (
                <Link href={item.href} className="rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">{item.label}</Link>
              ) : (
                <span className={last ? "text-body" : undefined} aria-current={last ? "page" : undefined}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Breadcrumbs derived from the nav config for the current route. */
export function AutoBreadcrumbs({ currentLabel, className }: { readonly currentLabel?: string; readonly className?: string }) {
  const pathname = usePathname();
  const items = React.useMemo(() => breadcrumbsFor(pathname, currentLabel), [pathname, currentLabel]);
  return <Breadcrumbs items={items} className={className} />;
}
