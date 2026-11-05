"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/layout/page-header";
import { SettingsTabs } from "./settings-tabs";
import { UsersTab } from "./users-tab";
import { WarehousesTab } from "./warehouses-tab";
import { CarriersTab } from "./carriers-tab";
import { AuditTab } from "./audit-tab";
import type { SettingsCounts, WarehouseCard } from "./types";

const TAB_KEYS = ["users", "warehouses", "carriers", "audit"] as const;
type TabKey = (typeof TAB_KEYS)[number];

function isTabKey(value: string | null): value is TabKey {
  return value !== null && (TAB_KEYS as readonly string[]).includes(value);
}

/**
 * Local header: the shared PageHeader floats its helper text centered in the
 * middle of the header band. Here the description sits left-aligned directly
 * under the h1 as a 13px muted subtitle (4px gap), keeping the band tight.
 */
function SettingsHeader({ actions }: { actions: React.ReactNode }) {
  return (
    <div className="px-6 pt-3">
      <Breadcrumbs items={[{ label: "Settings" }]} />
      <div className="mt-1.5 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">
            Settings
          </h1>
          <p className="mt-1 text-[13px] leading-5 text-secondary">
            Manage workspace users, warehouses, carrier connections and the audit
            trail.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
    </div>
  );
}

export interface SettingsPageProps {
  warehouses: WarehouseCard[];
  counts: SettingsCounts;
}

export function SettingsPage({ warehouses, counts }: SettingsPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get("tab");
  const activeTab: TabKey = isTabKey(tabParam) ? tabParam : "users";

  const setTab = React.useCallback(
    (key: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (key === "users") params.delete("tab");
      else params.set("tab", key);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const actions =
    activeTab === "users" ? (
      <>
        <Button variant="secondary" size="md">
          <Download className="h-3.5 w-3.5" aria-hidden />
          Import Users
        </Button>
        <Button variant="primary" size="md">
          <UserPlus className="h-3.5 w-3.5" aria-hidden />
          Invite User
        </Button>
      </>
    ) : activeTab === "warehouses" ? (
      <Button variant="primary" size="md">
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Create Warehouse
      </Button>
    ) : activeTab === "carriers" ? (
      <Button variant="primary" size="md">
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Connect Carrier
      </Button>
    ) : (
      <Button variant="secondary" size="md">
        <Download className="h-3.5 w-3.5" aria-hidden />
        Export Log
      </Button>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        Local shim for the global header search pill (app-shell.tsx is a
        read-only shared component): widen it to 280px and forbid wrapping so
        "Search orders, SKUs, locations…" can never break onto two lines
        inside the pill. Same scoped workaround the Receiving, Jobs, Clients
        and Inventory Snapshot pages ship; the real fix (plus shortening the
        copy to "Search orders, SKUs…") belongs in the shared TopNav — see
        the shared component request accompanying this change.
      */}
      <style>{`
        header button:has(> kbd) {
          width: 280px !important;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
      <SettingsHeader actions={actions} />
      <SettingsTabs
        className="mt-3"
        active={activeTab}
        onChange={setTab}
        tabs={[
          { key: "users", label: "Users & Roles", count: counts.users },
          { key: "warehouses", label: "Warehouses", count: counts.warehouses },
          { key: "carriers", label: "Carriers", count: counts.carriers },
          { key: "audit", label: "Audit Log", count: counts.audit },
        ]}
      />
      {activeTab === "users" ? (
        <UsersTab />
      ) : activeTab === "warehouses" ? (
        <WarehousesTab warehouses={warehouses} />
      ) : activeTab === "carriers" ? (
        <CarriersTab />
      ) : (
        <AuditTab />
      )}
      {activeTab === "users" || activeTab === "audit" ? (
        <div className="h-4 shrink-0" aria-hidden />
      ) : null}
    </div>
  );
}
