"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavigationMenu } from "radix-ui";
import { ArrowRight, ChevronDown } from "lucide-react";
import type { NavItem, NavMenu } from "@/config/nav-config";
import { activeItemHref, activeMenuKey } from "@/config/nav-access";
import { cn } from "@/lib/utils";
import { NAV_ICONS } from "./nav-icons";

/** Hover-intent delay before a menu opens (BUILD_PLAN F4.5). */
export const MENU_OPEN_DELAY_MS = 150;

function NavBadgeTag({ badge }: { readonly badge: NonNullable<NavItem["badge"]> }) {
  return (
    <span className="rounded bg-[#efe7fb] px-1 py-px text-[9px] font-bold uppercase leading-3 tracking-wide text-[#621db8]">
      {badge}
    </span>
  );
}

function MenuLink({ navItem, activeHref }: { readonly navItem: NavItem; readonly activeHref: string | null }) {
  const active = activeHref === navItem.href;
  return (
    <li>
      <NavigationMenu.Link asChild active={active}>
        <Link
          href={navItem.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium outline-none transition-colors",
            "hover:bg-primary-soft hover:text-primary focus-visible:bg-primary-soft focus-visible:text-primary focus-visible:ring-2 focus-visible:ring-info/60",
            active ? "bg-primary-soft text-primary" : "text-body",
          )}
        >
          <span className="min-w-0 whitespace-nowrap">{navItem.label}</span>
          {navItem.badge ? <NavBadgeTag badge={navItem.badge} /> : null}
        </Link>
      </NavigationMenu.Link>
    </li>
  );
}

function MenuPanel({ menu, pathname }: { readonly menu: NavMenu; readonly pathname: string }) {
  const activeHref = activeItemHref(menu, pathname);
  return (
    <div className="max-h-[calc(100vh-80px)] overflow-y-auto">
      <div className="flex flex-wrap divide-x divide-border py-4">
        {menu.columns.map((column) => {
          const Icon = NAV_ICONS[column.icon];
          return (
            <section key={column.heading} aria-label={column.heading} className="w-auto min-w-[220px] shrink-0 px-4 first:pl-5 last:pr-5">
              <h3 className="mb-2 flex items-center gap-1.5 px-2 text-[12px] font-semibold text-foreground">
                <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
                {column.heading}
              </h3>
              <ul className="flex flex-col gap-px">
                {column.items.map((navItem) => (
                  <MenuLink key={`${column.heading}:${navItem.href}`} navItem={navItem} activeHref={activeHref} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {menu.footer ? (
        <div className="border-t border-border bg-surface-sunken px-5 py-2">
          <NavigationMenu.Link asChild>
            <Link href={menu.footer.href} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-info/60">
              {menu.footer.label}
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          </NavigationMenu.Link>
        </div>
      ) : null}
    </div>
  );
}

const triggerClass =
  "group relative flex h-14 items-center gap-0.5 rounded-md px-1 text-[12.5px] xl:gap-1 xl:px-1.5 xl:text-[13px] min-[1440px]:px-2 font-semibold outline-none transition-colors " +
  "focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80 data-[state=open]:text-white";

/**
 * The 7 Logiwa-parity mega-menus. Radix NavigationMenu supplies hover intent, click and
 * full keyboard support (arrow keys between triggers, Tab into panels, Esc to close).
 */
export function MegaMenuBar({ menus, dashboardHref }: { readonly menus: readonly NavMenu[]; readonly dashboardHref: string }) {
  const pathname = usePathname();
  const activeKey = activeMenuKey(menus, pathname);
  const dashboardActive = pathname === dashboardHref || pathname.startsWith(`${dashboardHref}/`);
  const [value, setValue] = React.useState("");
  const [lastPath, setLastPath] = React.useState(pathname);
  if (lastPath !== pathname) {
    // Close any open menu after navigation (state adjusted during render, no effect).
    setLastPath(pathname);
    setValue("");
  }

  return (
    <NavigationMenu.Root value={value} onValueChange={setValue} delayDuration={MENU_OPEN_DELAY_MS} skipDelayDuration={300} aria-label="Main navigation" className="relative hidden lg:block">
      <NavigationMenu.List className="flex items-center">
        {/* The logo already goes home (Logiwa parity); the text link only fits from 1440px. */}
        <NavigationMenu.Item className="hidden min-[1440px]:block">
          <NavigationMenu.Link asChild active={dashboardActive}>
            <Link href={dashboardHref} className={cn(triggerClass, dashboardActive ? "text-white" : "text-white/80 hover:text-white")}>
              Dashboard
              <ActiveUnderline show={dashboardActive} />
            </Link>
          </NavigationMenu.Link>
        </NavigationMenu.Item>
        {menus.map((menu) => {
          const active = menu.key === activeKey;
          return (
            <NavigationMenu.Item key={menu.key} value={menu.key} className="relative">
              <NavigationMenu.Trigger className={cn(triggerClass, active ? "text-white" : "text-white/80 hover:text-white")}>
                {menu.label}
                <ChevronDown className="h-3.5 w-3.5 opacity-70 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
                <ActiveUnderline show={active} />
              </NavigationMenu.Trigger>
              <NavigationMenu.Content className="absolute left-0 top-full z-50">
                <ViewportClamp>
                  <MenuPanel menu={menu} pathname={pathname} />
                </ViewportClamp>
              </NavigationMenu.Content>
            </NavigationMenu.Item>
          );
        })}
      </NavigationMenu.List>
      {/* Dims the page under an open panel (Logiwa parity); a click outside closes the menu. */}
      <div
        aria-hidden
        onClick={() => setValue("")}
        className={cn("fixed inset-x-0 bottom-0 top-14 z-40 bg-black/20 transition-opacity duration-150", value ? "opacity-100" : "pointer-events-none opacity-0")}
      />
    </NavigationMenu.Root>
  );
}

/** Route-active underline; an open trigger shows it too, via Radix's own data-state. */
function ActiveUnderline({ show }: { readonly show: boolean }) {
  return <span aria-hidden className={cn("absolute inset-x-3 bottom-2 h-0.5 rounded-full bg-white transition-opacity", show ? "opacity-100" : "opacity-0 group-data-[state=open]:opacity-100")} />;
}

const VIEWPORT_GUTTER_PX = 16;

/** Keeps a panel anchored under its trigger but shifted horizontally to stay on screen. */
function ViewportClamp({ children }: { readonly children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [shift, setShift] = React.useState(0);
  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const left = rect.left - shift;
    const right = left + rect.width;
    const maxRight = window.innerWidth - VIEWPORT_GUTTER_PX;
    const next = right > maxRight ? Math.max(maxRight - right, VIEWPORT_GUTTER_PX - left) : 0;
    if (next !== shift) setShift(next);
  }, [shift]);
  return (
    <div
      ref={ref}
      style={{ transform: `translateX(${shift}px)`, maxWidth: `calc(100vw - ${VIEWPORT_GUTTER_PX * 2}px)` }}
      className="mt-1 w-max rounded-lg border border-border bg-surface shadow-lg"
    >
      {children}
    </div>
  );
}
