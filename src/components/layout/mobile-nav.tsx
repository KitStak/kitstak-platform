"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Accordion, Dialog as DialogPrimitive } from "radix-ui";
import { ChevronDown, Menu, X } from "lucide-react";
import type { NavMenu } from "@/config/nav-config";
import { activeItemHref, activeMenuKey } from "@/config/nav-access";
import { overlayClass } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { NAV_ICONS } from "./nav-icons";

/** Below 1024 px the mega-menus collapse into this left drawer (BUILD_PLAN F4.5). */
export function MobileNav({ menus, dashboardHref }: { readonly menus: readonly NavMenu[]; readonly dashboardHref: string }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const activeKey = activeMenuKey(menus, pathname);

  const [lastPath, setLastPath] = React.useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button type="button" aria-label="Open navigation" className="flex h-8 w-8 items-center justify-center rounded-md text-fg-secondary hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus lg:hidden">
          <Menu className="h-5 w-5" aria-hidden />
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass} />
        <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-[320px] max-w-[88vw] flex-col bg-surface shadow-lg outline-none">
          <div className="flex h-14 items-center justify-between border-b border-border-subtle bg-panel px-4">
            <DialogPrimitive.Title className="text-base font-semibold text-fg">Menu</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Main navigation</DialogPrimitive.Description>
            <DialogPrimitive.Close aria-label="Close navigation" className="flex h-8 w-8 items-center justify-center rounded-md text-fg-secondary hover:bg-hover">
              <X className="h-4 w-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <nav aria-label="Main navigation" className="flex-1 overflow-y-auto p-2">
            <Link href={dashboardHref} className={cn("block rounded-md px-3 py-2 text-sm font-semibold", pathname.startsWith(dashboardHref) ? "bg-primary-soft text-primary" : "text-body hover:bg-neutral-soft")}>
              Dashboard
            </Link>
            <Accordion.Root type="single" collapsible defaultValue={activeKey ?? undefined}>
              {menus.map((menu) => (
                <Accordion.Item key={menu.key} value={menu.key} className="border-b border-border last:border-b-0">
                  <Accordion.Header>
                    <Accordion.Trigger className="group flex w-full items-center justify-between rounded-md px-3 py-2.5 text-sm font-semibold text-foreground hover:bg-neutral-soft">
                      {menu.label}
                      <ChevronDown className="h-4 w-4 text-faint transition-transform group-data-[state=open]:rotate-180" aria-hidden />
                    </Accordion.Trigger>
                  </Accordion.Header>
                  <Accordion.Content className="pb-2">
                    {menu.columns.map((column) => {
                      const Icon = NAV_ICONS[column.icon];
                      return (
                        <div key={column.heading} className="px-2 pt-1">
                          <p className="flex items-center gap-1.5 px-2 py-1 text-2xs font-bold text-faint">
                            <Icon className="h-3 w-3" aria-hidden />
                            {column.heading}
                          </p>
                          {column.items.map((navItem) => (
                            <Link
                              key={`${column.heading}:${navItem.href}`}
                              href={navItem.href}
                              className={cn("block rounded-md px-3 py-1.5 text-sm", activeItemHref(menu, pathname) === navItem.href ? "bg-primary-soft font-semibold text-primary" : "text-body hover:bg-neutral-soft")}
                            >
                              {navItem.label}
                              {navItem.badge ? <span className="ml-1.5 text-2xs font-bold text-fg-muted">{navItem.badge}</span> : null}
                            </Link>
                          ))}
                        </div>
                      );
                    })}
                  </Accordion.Content>
                </Accordion.Item>
              ))}
            </Accordion.Root>
          </nav>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
