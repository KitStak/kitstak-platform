"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Info,
  ListChecks,
  Package,
  Truck,
  Users,
} from "lucide-react";
import type { OrderDetail } from "@/server/repositories/orders";
import { Breadcrumbs } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmSection } from "./confirm-section";
import { deriveSectionStates, type SectionKey } from "./order-derive";
import {
  CustomerAddressSection,
  OrderDetailsSection,
  OtherInfoSection,
} from "./order-sections";
import { ProductsSection } from "./products-section";
import { OrderRightRail } from "./right-rail";
import { ShippingSection } from "./shipping-section";
import { WizardStepper, type WizardStep } from "./wizard-stepper";

const STEP_ORDER: ReadonlyArray<{
  key: SectionKey;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: "details", name: "Order Details", icon: ListChecks },
  { key: "customer", name: "Customer & Address", icon: Users },
  { key: "products", name: "Products", icon: Package },
  { key: "shipping", name: "Shipping", icon: Truck },
  { key: "other", name: "Other Info", icon: Info },
  { key: "confirm", name: "Confirm", icon: CheckCircle2 },
];

export interface OrderDetailPageProps {
  detail: OrderDetail;
}

export function OrderDetailPage({ detail }: OrderDetailPageProps) {
  const [activeKey, setActiveKey] = React.useState<SectionKey>("details");
  const states = React.useMemo(() => deriveSectionStates(detail), [detail]);
  const { order } = detail;

  const steps: WizardStep[] = STEP_ORDER.map((step, idx) => ({
    key: step.key,
    stepLabel: `Step ${idx + 1}`,
    name: step.name,
    icon: step.icon,
    state: states[step.key],
  }));

  const activeIdx = STEP_ORDER.findIndex((s) => s.key === activeKey);
  const nextKey = activeIdx < STEP_ORDER.length - 1 ? STEP_ORDER[activeIdx + 1].key : null;
  const footer = nextKey ? (
    <Button variant="primary" onClick={() => setActiveKey(nextKey)}>
      Next Step
    </Button>
  ) : (
    <Button variant="primary">Save Shipment Order</Button>
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="px-6 pb-6 pt-3">
        <Breadcrumbs
          items={[{ label: "Orders", href: "/orders" }, { label: order.code }]}
        />
        <div className="mt-1.5 flex items-center gap-2">
          <Link
            href="/orders"
            aria-label="Back to Shipment Orders"
            className="flex h-7 w-7 items-center justify-center rounded-md text-secondary outline-none transition-colors hover:bg-neutral-soft hover:text-body focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">
            Shipment Order {order.code}
          </h1>
        </div>

        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <WizardStepper steps={steps} activeKey={activeKey} onSelect={(key) => setActiveKey(key as SectionKey)} />
            <div className="mt-4">
              {activeKey === "details" ? (
                <OrderDetailsSection order={order} footer={footer} />
              ) : activeKey === "customer" ? (
                <CustomerAddressSection order={order} footer={footer} />
              ) : activeKey === "products" ? (
                <ProductsSection lines={detail.lines} footer={footer} />
              ) : activeKey === "shipping" ? (
                <ShippingSection order={order} footer={footer} />
              ) : activeKey === "other" ? (
                <OtherInfoSection order={order} footer={footer} />
              ) : (
                <ConfirmSection timeline={detail.timeline} footer={footer} />
              )}
            </div>
          </div>
          <OrderRightRail detail={detail} />
        </div>
      </div>
    </div>
  );
}
