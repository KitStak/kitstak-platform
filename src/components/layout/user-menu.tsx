"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LogOut, Monitor, MonitorX, Moon, Sun } from "lucide-react";
import { USER_MENU_ITEMS } from "@/config/nav-config";
import { apiRequest } from "@/lib/api-client";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { DEFAULT_NAV_ICON, NAV_ICONS } from "./nav-icons";
import { roleLabel } from "./role-label";
import { useShell, useShellAllows } from "./shell-context";

export { roleLabel } from "./role-label";

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Match system", icon: Monitor },
];

/** Appearance: Light / Dark / Match system (saved in this browser). */
function ThemeSubmenu() {
  const { preference, resolved, setPreference } = useTheme();
  const current = THEME_OPTIONS.find((o) => o.value === preference) ?? THEME_OPTIONS[2];
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger icon={resolved === "dark" ? Moon : Sun}>
        <span className="flex items-center justify-between gap-2">
          Appearance
          <span className="text-[12px] text-faint">{current?.label}</span>
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={preference} onValueChange={(value) => setPreference(value as ThemePreference)}>
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon className="h-4 w-4 shrink-0 text-secondary" aria-hidden />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** User menu: profile links (permission-filtered), appearance, Sign out, Sign out all sessions. */
export function UserMenu() {
  const queryClient = useQueryClient();
  const { user } = useShell();
  const allows = useShellAllows();
  const [busy, setBusy] = React.useState(false);
  const items = USER_MENU_ITEMS.filter((navItem) => allows(navItem.permission));
  const name = user?.name || user?.email || "Account";

  const signOut = async (everywhere: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await apiRequest(everywhere ? "/api/auth/logout-all" : "/api/auth/logout", { method: "POST", body: everywhere ? { includeCurrent: true } : {} });
      // Stop in-flight polling and leave with a full navigation: clearing the cache while the
      // shell is still mounted would refetch /api/me without a session (a console 401).
      await queryClient.cancelQueries();
      // A full page load on sign-out is deliberate: it drops every piece of in-memory client state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/login");
    } catch (error) {
      setBusy(false);
      toast.error("Sign out failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-1.5 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/50 data-[state=open]:bg-white/15">
          <Avatar name={name} size="sm" tone="brand" />
          <span className="sr-only">{` Account menu for ${name}`}</span>
          <ChevronDown className="h-3.5 w-3.5 text-white/60" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <Avatar name={name} tone="brand" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-foreground">{name}</p>
            <p className="truncate text-[11px] text-faint">{user ? `${roleLabel(user.role)} · ${user.email}` : ""}</p>
          </div>
        </div>
        <DropdownMenuSeparator />
        {items.map((navItem) => (
          <DropdownMenuItem key={navItem.href} icon={navItem.icon ? NAV_ICONS[navItem.icon] : DEFAULT_NAV_ICON} href={navItem.href}>
            {navItem.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <ThemeSubmenu />
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={LogOut} disabled={busy} onSelect={() => void signOut(false)}>Sign out</DropdownMenuItem>
        <DropdownMenuItem icon={MonitorX} destructive disabled={busy} description="Ends every session on every device" onSelect={() => void signOut(true)}>
          Sign out all sessions
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
