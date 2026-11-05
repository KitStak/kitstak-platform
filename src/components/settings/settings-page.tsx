"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, UnderlineTabs } from "@/components/layout/page-header";
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
      <PageHeader
        breadcrumbs={[{ label: "Settings" }]}
        title="Settings"
        helper="Manage workspace users, warehouses, carrier connections and the audit trail."
        actions={actions}
      />
      <UnderlineTabs
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
