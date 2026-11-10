"use client";

/**
 * Create shipment order (`/orders/new`): six-step linear wizard, right rail (progress
 * ring 0–100%, price summary, Save order), top-right Cancel order behind the
 * unsaved-changes guard, success screen with next-step cards.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, List, PlusCircle, X } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useCan } from "@/lib/permissions-client";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { WizardSuccess, type WizardController } from "@/components/ui/wizard";
import { clearDraft, sessionStorageOrNull } from "@/components/ui/wizard/wizard-state";
import { PageHeader } from "@/components/layout/page-header";
import { orderCrumbs } from "../order-crumbs";
import { useInvalidateOrders, useOrderOptions } from "../orders-client";
import { addressNeedsAttention, createBody, requiredCompletion, defaultOrderValues, type OrderFormValues } from "./order-form-model";
import { carrierLookup, reportSaveError } from "./order-save";
import { buildOrderSteps } from "./order-steps";
import { PriceSummary, RailCard, StatusCard } from "./order-summary";
import { OrderWizardProvider } from "./order-wizard-context";
import { OrderWizardShell } from "./order-wizard-shell";

export const ORDER_CREATE_DRAFT_SCOPE = "order-create";

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
  const [dirty, setDirty] = React.useState(false);
  const [confirmCancel, setConfirmCancel] = React.useState(false);

  /** Cancel order: the session draft is discarded (no "Draft restored" on the next visit), then back to the list. */
  const leaveWithoutSaving = () => {
    wizardRef.current?.restart();
    clearDraft(sessionStorageOrNull(), ORDER_CREATE_DRAFT_SCOPE);
    setDirty(false);
    // Navigate after the guard has re-rendered with the clean form.
    window.setTimeout(() => router.push("/orders"), 0);
  };

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
    optionsRefreshing: options.isPlaceholderData,
    locks: { header: null, lines: null },
    detail: null,
    canCreateProduct,
    canManageCustomFields,
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader
        title="Create shipment order"
        breadcrumbs={orderCrumbs({ label: "Shipment Orders", href: "/orders" }, "Create shipment order")}
        helper="Follow the steps to create an order manually. It lands in the backlog as Open."
        actions={
          created ? null : (
            <Button variant="secondary" onClick={() => (dirty ? setConfirmCancel(true) : leaveWithoutSaving())}>
              <X className="h-3.5 w-3.5" aria-hidden />
              Cancel order
            </Button>
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
          draftScope={ORDER_CREATE_DRAFT_SCOPE}
          onDirtyChange={setDirty}
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
                percent={requiredCompletion(values)}
                subtitle={requiredCompletion(values) >= 100 ? "Ready to save" : "Follow all the steps to complete the order"}
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
                  // Three next-step cards in three equal columns (the shared grid defaults to two).
                  className="sm:[&_.grid]:max-w-[920px] sm:[&_.grid]:grid-cols-3"
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
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        variant="danger"
        title="Discard this order?"
        description="Nothing has been saved. The details you entered and the session draft are removed."
        cancelLabel="Keep editing"
        confirmLabel="Discard order"
        onConfirm={() => {
          setConfirmCancel(false);
          leaveWithoutSaving();
        }}
      />
    </div>
  );
}
