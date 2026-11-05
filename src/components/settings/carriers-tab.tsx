"use client";

import * as React from "react";
import { Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface CarrierConfig {
  id: string;
  name: string;
  initials: string;
  tileClass: string;
  accountLabel: string;
  services: string[];
  enabledByDefault: boolean;
  lastSync: string;
}

const CARRIERS: CarrierConfig[] = [
  {
    id: "fedex",
    name: "FedEx",
    initials: "Fx",
    tileClass: "bg-[#4d148c]/10 text-[#4d148c]",
    accountLabel: "Account •••• 4482",
    services: [
      "FedEx Ground",
      "FedEx Home Delivery",
      "FedEx 2Day",
      "FedEx Standard Overnight",
    ],
    enabledByDefault: true,
    lastSync: "Rates synced 4 min ago",
  },
  {
    id: "ups",
    name: "UPS",
    initials: "UP",
    tileClass: "bg-[#351c15]/10 text-[#351c15]",
    accountLabel: "Account •••• 09R2",
    services: ["UPS Ground", "UPS 2nd Day Air", "UPS Next Day Air Saver"],
    enabledByDefault: true,
    lastSync: "Rates synced 11 min ago",
  },
  {
    id: "usps",
    name: "USPS",
    initials: "US",
    tileClass: "bg-[#004b87]/10 text-[#004b87]",
    accountLabel: "Account •••• 7715",
    services: [
      "Ground Advantage",
      "Priority Mail",
      "Priority Mail Express",
      "First-Class Package Intl",
    ],
    enabledByDefault: true,
    lastSync: "Rates synced 26 min ago",
  },
  {
    id: "dhl-ecommerce",
    name: "DHL eCommerce",
    initials: "DH",
    tileClass: "bg-[#ffcc00]/25 text-[#9a7b00]",
    accountLabel: "Not connected",
    services: ["Parcel Expedited", "Parcel Ground", "Parcel International Direct"],
    enabledByDefault: false,
    lastSync: "Never synced",
  },
];

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        checked ? "bg-primary" : "bg-border-strong"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-transform duration-150",
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        )}
        aria-hidden
      />
    </button>
  );
}

function CarrierCard({ carrier }: { carrier: CarrierConfig }) {
  const [enabled, setEnabled] = React.useState(carrier.enabledByDefault);
  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-3 px-5 pb-3 pt-4">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold",
            carrier.tileClass
          )}
          aria-hidden
        >
          {carrier.initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-foreground">
            {carrier.name}
          </p>
          <p className="truncate text-[11px] text-faint">{carrier.accountLabel}</p>
        </div>
        <Toggle
          checked={enabled}
          onChange={setEnabled}
          label={`${enabled ? "Disable" : "Enable"} ${carrier.name}`}
        />
      </div>

      <div
        className={cn(
          "flex flex-1 flex-col gap-3 border-t border-border px-5 py-3.5 transition-opacity",
          !enabled && "opacity-50"
        )}
      >
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.04em] text-faint">
            Enabled Services
          </p>
          <div className="flex flex-wrap gap-1.5">
            {carrier.services.map((service) => (
              <span
                key={service}
                className="inline-flex items-center rounded-full border border-border bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-secondary"
              >
                {service}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="text-[11px] text-faint">{carrier.lastSync}</span>
          <Button variant="secondary" size="sm" disabled={!enabled}>
            <Plug className="h-3.5 w-3.5" aria-hidden />
            Test Connection
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function CarriersTab() {
  return (
    <div className="flex flex-col gap-3 px-6 py-4">
      <p className="text-[12px] text-faint">
        Carrier accounts used for rate shopping and label purchase. Disable a
        carrier to exclude it from rate quotes without removing its credentials.
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {CARRIERS.map((carrier) => (
          <CarrierCard key={carrier.id} carrier={carrier} />
        ))}
      </div>
    </div>
  );
}
