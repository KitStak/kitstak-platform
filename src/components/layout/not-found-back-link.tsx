"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROUTE_REGISTRY, breadcrumbsFor } from "@/config/route-registry";
import { Breadcrumbs } from "./breadcrumbs";

export interface BackTarget {
  readonly label: string;
  readonly href: string;
}

/** `/orders/does-not-exist` → "Back to Shipment Orders" → `/orders` (the list the record lives in). */
export function backTargetFor(pathname: string): BackTarget | null {
  const first = pathname.split("/").filter(Boolean)[0];
  if (!first) return null;
  const href = `/${first}`;
  if (pathname.replace(/\/+$/, "") === href) return null;
  const info = ROUTE_REGISTRY.get(href);
  return info ? { label: `Back to ${info.label}`, href } : null;
}

/** Secondary 404 action derived from the URL; renders nothing for unknown sections. */
export function NotFoundBackLink() {
  const target = backTargetFor(usePathname() ?? "/");
  if (!target) return null;
  return (
    <Link href={target.href} className="inline-flex h-9 items-center rounded-md border border-border-strong/70 bg-surface px-4 text-[13px] font-medium text-body hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30">
      {target.label}
    </Link>
  );
}

/**
 * `Home › Fulfillment › Shipment Orders › Not found` above a record 404: the same
 * nav-config trail the record page would show, so the user keeps their place.
 */
export function NotFoundBreadcrumbs() {
  const pathname = usePathname() ?? "/";
  if (!backTargetFor(pathname)) return null;
  return (
    <div className="px-6 pt-3">
      <Breadcrumbs items={breadcrumbsFor(pathname, "Not found")} />
    </div>
  );
}
