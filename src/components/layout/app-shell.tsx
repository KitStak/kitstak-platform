"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Boxes,
  ChevronDown,
  CircleHelp,
  History,
  LogOut,
  Printer,
  Search,
  Settings,
  UserRound,
  Warehouse,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_MENUS } from "./nav-config";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";

function Logo() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 pr-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-[#5c82f2] to-[#2ec5a8]">
        <Boxes className="h-4 w-4 text-white" aria-hidden />
      </span>
      <span className="text-[15px] font-bold tracking-tight text-white">
        KitStak
        <span className="ml-1 rounded bg-white/10 px-1 py-px text-[9px] font-semibold uppercase tracking-widest text-white/70">
          WMS
        </span>
      </span>
    </Link>
  );
}

function MegaMenu({
  menu,
  onNavigate,
}: {
  menu: (typeof NAV_MENUS)[number];
  onNavigate: () => void;
}) {
  return (
    <div className="flex gap-8 p-5">
      {menu.sections.map((section) => (
        <div key={section.heading} className="min-w-[160px]">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-faint">
            {section.heading}
          </p>
          <ul className="flex flex-col">
            {section.links.map((link) => (
              <li key={link.label}>
                <Link
                  href={link.href}
                  onClick={onNavigate}
                  className="block rounded-md px-2 py-1.5 text-[13px] font-medium text-body transition-colors hover:bg-primary-soft hover:text-primary"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function TopNav({ userName, role }: { userName: string; role: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [openMenu, setOpenMenu] = React.useState<string | null>(null);
  const navRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setOpenMenu(null);
  }, [pathname]);

  React.useEffect(() => {
    if (!openMenu) return;
    function onPointerDown(e: PointerEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const menuActive = (label: string) => {
    const menu = NAV_MENUS.find((m) => m.label === label);
    if (!menu) return false;
    return menu.sections.some((s) =>
      s.links.some((l) => pathname.startsWith(l.href.split("?")[0]))
    );
  };

  return (
    <header ref={navRef} className="relative z-40 bg-nav shadow-md">
      <div className="flex h-14 items-center gap-1 px-4">
        <Logo />
        <nav className="ml-2 flex items-center gap-0.5" aria-label="Main navigation">
          <Link
            href="/dashboard"
            className={cn(
              "rounded-md px-3 py-2 text-[13px] font-semibold transition-colors",
              pathname.startsWith("/dashboard")
                ? "bg-white/10 text-white"
                : "text-white/80 hover:bg-nav-hover hover:text-white"
            )}
          >
            Dashboard
          </Link>
          {NAV_MENUS.map((menu) => (
            <div key={menu.label} className="relative">
              <button
                type="button"
                aria-expanded={openMenu === menu.label}
                onClick={() =>
                  setOpenMenu(openMenu === menu.label ? null : menu.label)
                }
                className={cn(
                  "flex items-center gap-1 rounded-md px-3 py-2 text-[13px] font-semibold transition-colors",
                  openMenu === menu.label || menuActive(menu.label)
                    ? "bg-white/10 text-white"
                    : "text-white/80 hover:bg-nav-hover hover:text-white"
                )}
              >
                {menu.label}
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 opacity-70 transition-transform",
                    openMenu === menu.label && "rotate-180"
                  )}
                  aria-hidden
                />
              </button>
              {openMenu === menu.label ? (
                <div className="absolute left-0 top-full z-50 mt-1 min-w-[320px] rounded-lg border border-border bg-surface shadow-lg">
                  <MegaMenu menu={menu} onNavigate={() => setOpenMenu(null)} />
                </div>
              ) : null}
            </div>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            className="flex h-8 w-64 items-center gap-2 rounded-full bg-white/10 px-3 text-[12px] text-white/60 transition-colors hover:bg-white/15 hover:text-white/80"
          >
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate whitespace-nowrap text-left">
              Search orders, SKUs…
            </span>
            <kbd className="ml-auto shrink-0 rounded bg-white/10 px-1.5 py-px text-[10px] font-semibold text-white/50">
              /
            </kbd>
          </button>

          <div className="mx-1 flex items-center gap-0.5 rounded-full bg-white/5 p-0.5">
            {[
              { icon: History, label: "Activity history" },
              { icon: Printer, label: "Print queue" },
              { icon: CircleHelp, label: "Help center" },
              { icon: Bell, label: "Notifications" },
            ].map(({ icon: Icon, label }) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                title={label}
                className="relative flex h-7 w-7 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white"
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label === "Notifications" ? (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#f97066] ring-2 ring-nav" />
                ) : null}
              </button>
            ))}
          </div>

          <Dropdown
            align="end"
            trigger={() => (
              <button
                type="button"
                className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-white/10"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#5c82f2] to-[#8b5cf6] text-[11px] font-bold text-white">
                  {userName
                    .split(" ")
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-white/60" aria-hidden />
              </button>
            )}
          >
            <div className="px-3 py-2">
              <p className="text-[13px] font-semibold text-foreground">{userName}</p>
              <p className="text-[11px] capitalize text-faint">{role}</p>
            </div>
            <DropdownSeparator />
            <DropdownItem>
              <UserRound className="h-3.5 w-3.5" aria-hidden /> Profile
            </DropdownItem>
            <DropdownItem onClick={() => router.push("/settings")}>
              <Settings className="h-3.5 w-3.5" aria-hidden /> Settings
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem destructive onClick={handleLogout}>
              <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
            </DropdownItem>
          </Dropdown>
        </div>
      </div>
    </header>
  );
}

export function WarehouseBar({
  warehouse = "MLT1 – Main Fulfillment",
}: {
  warehouse?: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface px-6 py-2">
      <span className="flex items-center gap-1.5 rounded-md border border-border bg-surface-sunken px-2.5 py-1 text-[12px] font-medium text-body">
        <Warehouse className="h-3.5 w-3.5 text-secondary" aria-hidden />
        {warehouse}
        <ChevronDown className="h-3 w-3 text-faint" aria-hidden />
      </span>
      <span className="text-[11px] text-faint">
        All data scoped to this facility
      </span>
    </div>
  );
}
