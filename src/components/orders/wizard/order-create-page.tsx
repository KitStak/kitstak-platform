"use client";

/**
 * Create shipment order (`/orders/new`): six-step linear wizard, right rail (progress
 * ring 0–100%, price summary, Save order), top-right Cancel order behind the
 * unsaved-changes guard, success screen with next-step cards.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, List, PlusCircle, X } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useCan } from "@/lib/permissions-client";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { buttonVariants } from "@/components/ui/button";
import { WizardSuccess, type WizardController } from "@/components/ui/wizard";
import { PageHeader } from "@/components/layout/page-header";
import { useInvalidateOrders, useOrderOptions } from "../orders-client";
import { addressNeedsAttention, createBody, defaultOrderValues, type OrderFormValues } from "./order-form-model";
import { carrierLookup, reportSaveError } from "./order-save";
import { buildOrderSteps } from "./order-steps";
import { PriceSummary, RailCard, StatusCard } from "./order-summary";
import { OrderWizardProvider } from "./order-wizard-context";
import { OrderWizardShell } from "./order-wizard-shell";

interface Created {
  readonly id: string;
  readonly code: string;
}

export function OrderCreatePage() {
  const router = useRouter();
  const invalidate = useInvalidateOrders();
  const [defaults] = React.useState<OrderFormValues>(() => defaultOrderValues());
  const [scope, setScope] = React.useState<{ warehouseId: string; clientId: string }>({ warehouseId: "", clientId: "" });
  const [created, setCreated] = React.useState<Created | null>(null);
  const [run, setRun] = React.useState(0);
  const wizardRef = React.useRef<WizardController<OrderFormValues> | null>(null);
  const options = useOrderOptions(scope.warehouseId || null, scope.clientId || null);
  const canCreateProduct = useCan(ORDER_PERMISSIONS.createProduct).allowed;
  const canManageCustomFields = useCan(ORDER_PERMISSIONS.customFields).allowed;
  const steps = React.useMemo(() => buildOrderSteps("create"), []);

  const submit = async (values: OrderFormValues) => {
    try {
      const order = await apiFetch<Created>("/api/orders", { method: "POST", body: createBody(values, carrierLookup(options.data?.data)) });
      setCreated(order);
      await invalidate();
    } catch (error) {
      reportSaveError(error, wizardRef.current, "create");
      throw error;
    }
  };

  const ctx = {
    mode: "create" as const,
    options: options.data?.data,
    optionsLoading: options.isLoading,
    locks: { header: null, lines: null },
    detail: null,
    canCreateProduct,
    canManageCustomFields,
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader
        title="Create shipment order"
        crumbLabel="Create shipment order"
        helper="Follow the steps to create an order manually. It lands in the backlog as Open."
        actions={
          created ? null : (
            <Link href="/orders" className={buttonVariants({ variant: "secondary" })}>
              <X className="h-3.5 w-3.5" aria-hidden />
              Cancel order
            </Link>
          )
        }
      />
      <div className="px-6">
      <OrderWizardProvider value={ctx}>
        <OrderWizardShell<OrderFormValues>
          key={run}
          steps={steps}
          mode="linear"
          defaultValues={defaults}
          draftScope="order-create"
          onComplete={submit}
          onController={(w) => {
            wizardRef.current = w;
            const v = w.form.getValues();
            if (v.warehouseId !== scope.warehouseId || v.clientId !== scope.clientId) setScope({ warehouseId: v.warehouseId, clientId: v.clientId });
          }}
          attention={(v) => (addressNeedsAttention(v) ? ["customer"] : [])}
          rail={(values, wizard) => (
            <>
              <StatusCard
                percent={wizard.percent}
                subtitle={wizard.percent >= 100 ? "Ready to save" : "Follow all the steps to complete the order"}
                saveLabel="Save order"
                onSave={() => void wizard.submit()}
                saving={wizard.submitting}
                disabledReason={wizard.saveDisabledReason}
              />
              <RailCard title="Summary">
                <PriceSummary values={values} />
              </RailCard>
            </>
          )}
          success={
            created ? (
              <div className="rounded-lg border border-border bg-surface px-6 py-12 shadow-xs">
                <WizardSuccess
                  entity={`a new shipment order: ${created.code}`}
                  description="The order is Open in the backlog. Create a picking job from it when you're ready."
                  options={[
                    { title: "Go back to shipment order list", description: "Turn to the shipment order screen to see the full list of orders.", icon: List, href: "/orders" },
                    {
                      title: "Create another order",
                      description: "Turn to the create order form and continue your operation nonstop.",
                      icon: PlusCircle,
                      onClick: () => {
                        setCreated(null);
                        setRun((n) => n + 1);
                      },
                    },
                    { title: "View order", description: `Open ${created.code} to allocate, print or ship it.`, icon: Eye, onClick: () => router.push(`/orders/${encodeURIComponent(created.code)}`) },
                  ]}
                />
              </div>
            ) : undefined
          }
        />
      </OrderWizardProvider>
      </div>
    </div>
  );
}
