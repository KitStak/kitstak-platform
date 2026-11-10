"use client";

/** Step 1 — Order details: warehouse, client, code (auto + inline uniqueness), type, dates, note, priority. */
import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { FormGrid, FormGridFull } from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";
import { AreaF, ComboF, DateTimeF, NumF, SelectF, TextF } from "./fields";
import { NOTE_MAX, ORDER_CODE_MAX, type OrderFormValues } from "./order-form-model";
import { LOCKED_FIELD_REASON, useOrderWizard } from "./order-wizard-context";

interface CodeCheck {
  readonly code: string;
  readonly available: boolean;
  readonly suggested: string;
}

const CODE_DEBOUNCE_MS = 350;

function useOrderCode(enabled: boolean, excludeId: string | null) {
  const { setValue, getValues, control } = useFormContext<OrderFormValues>();
  const code = useWatch({ control, name: "code" });
  const [checking, setChecking] = React.useState(false);

  const regenerate = React.useCallback(async () => {
    setChecking(true);
    try {
      const res = await apiFetch<CodeCheck>("/api/orders/code-check");
      setValue("code", res.suggested, { shouldDirty: true, shouldValidate: true });
      setValue("codeTaken", false);
    } finally {
      setChecking(false);
    }
  }, [setValue]);

  /* Fill the next sequence value on a fresh create. */
  React.useEffect(() => {
    if (enabled && !getValues("code")) void regenerate();
  }, [enabled, getValues, regenerate]);

  /* Inline uniqueness check (debounced). */
  React.useEffect(() => {
    const value = (code ?? "").trim();
    if (!enabled || !value) return undefined;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setChecking(true);
      apiFetch<CodeCheck>("/api/orders/code-check", { query: { code: value, excludeId: excludeId ?? undefined }, signal: ctrl.signal })
        .then((res) => {
          if (getValues("code").trim() !== value) return;
          setValue("codeTaken", !res.available, { shouldValidate: false });
        })
        .catch(() => undefined)
        .finally(() => setChecking(false));
    }, CODE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [code, enabled, excludeId, getValues, setValue]);

  return { checking, regenerate };
}

export function StepDetails() {
  const { mode, options, locks, detail } = useOrderWizard();
  const { setValue, getValues, control, trigger, formState } = useFormContext<OrderFormValues>();
  const warehouseId = useWatch({ control, name: "warehouseId" });
  const codeTaken = useWatch({ control, name: "codeTaken" });
  const create = mode === "create";
  const { checking, regenerate } = useOrderCode(create, detail?.order.id ?? null);
  const headerLock = locks.header;

  /* Re-run the code rule when the uniqueness flag flips, so the inline error shows / clears. */
  React.useEffect(() => {
    if (formState.touchedFields.code || codeTaken) void trigger("code");
  }, [codeTaken, trigger, formState.touchedFields.code]);

  /* Preselect the only warehouse and the default order type. */
  React.useEffect(() => {
    if (!create || !options) return;
    if (!getValues("warehouseId") && options.warehouses.length === 1) setValue("warehouseId", options.warehouses[0]?.value ?? "", { shouldDirty: true });
    if (!getValues("orderTypeId") && options.orderTypes.length > 0) {
      const preferred = options.orderTypes.find((o) => /d2c/i.test(o.label)) ?? options.orderTypes[0];
      if (preferred) {
        setValue("orderTypeId", preferred.value, { shouldDirty: true });
        setValue("orderTypeName", preferred.label);
      }
    }
  }, [create, options, getValues, setValue]);

  /* Edit mode: the saved order may sit outside the option lists (or they are still loading) — never show a raw id. */
  React.useEffect(() => {
    if (create || !options || !detail || getValues("orderTypeId")) return;
    const match = options.orderTypes.find((o) => o.label === detail.orderTypeName);
    if (match) {
      setValue("orderTypeId", match.value);
      setValue("orderTypeName", match.label);
    }
  }, [create, options, detail, getValues, setValue]);

  const withSaved = <T extends { value: string; label: string }>(list: T[], id: string | undefined, label: string | undefined): T[] =>
    id && label && !list.some((o) => o.value === id) ? [...list, { value: id, label } as T] : list;
  const warehouseOptions = withSaved((options?.warehouses ?? []).map((o) => ({ value: o.value, label: o.label })), detail?.order.warehouseId, detail?.warehouseLabel);
  const clientOptions = withSaved(
    (options?.clients ?? []).map((o) => ({ value: o.value, label: o.label, description: o.description ?? undefined })),
    detail?.order.clientId, detail?.clientName,
  );
  const typeOptions = (options?.orderTypes ?? []).map((o) => ({ value: o.value, label: o.label }));
  const locked = create ? undefined : LOCKED_FIELD_REASON;

  return (
    <FormGrid columns={3}>
      <ComboF
        name="warehouseId"
        label="Warehouse"
        required
        disabled={!create}
        description={locked}
        options={warehouseOptions}
        placeholder="Select warehouse"
        onValue={() => {
          setValue("carrierConnectionId", null);
          setValue("carrierServiceId", null);
          setValue("shipmentPackageId", null);
        }}
      />
      <ComboF
        name="clientId"
        label="Client"
        required
        disabled={!create || !warehouseId}
        description={!create ? locked : !warehouseId ? "Choose a warehouse first" : undefined}
        options={clientOptions}
        placeholder="Select client"
        onValue={() => {
          if (getValues("lines").length > 0) setValue("lines", [], { shouldDirty: true });
          setValue("customerId", null);
        }}
      />
      <TextF
        name="code"
        label="Order code"
        required
        maxLength={ORDER_CODE_MAX}
        disabled={!create}
        description={create ? undefined : "Order codes can't be changed after save."}
        info="Auto generated from the shipment order sequence. You can type your own code; it must be unique."
        onValue={() => setValue("codeTaken", false)}
        trailing={
          create ? (
            checking ? (
              <Spinner className="h-3.5 w-3.5" label="Checking code" />
            ) : (
              <button type="button" onClick={() => void regenerate()} className="flex items-center gap-1 whitespace-nowrap rounded text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                <RefreshCw className="h-3 w-3" aria-hidden />
                auto generated
              </button>
            )
          ) : undefined
        }
      />
      <SelectF
        name="orderTypeId"
        label="Order type"
        required
        disabled={Boolean(headerLock)}
        options={typeOptions}
        info="Select an order type or create a new one from Data setup under Settings."
        onValue={(v) => setValue("orderTypeName", typeOptions.find((o) => o.value === v)?.label ?? "")}
      />
      <DateTimeF name="orderDate" label="Order date" required disabled={Boolean(headerLock)} />
      <DateTimeF name="expectedShipDate" label="Expected shipment date" required disabled={Boolean(headerLock)} />
      <DateTimeF name="expectedDeliveryDate" label="Expected delivery date" disabled={Boolean(headerLock)} />
      <DateTimeF name="carrierExpectedDeliveryDate" label="Carrier expected delivery date" disabled info="Filled in by the carrier when a label is created." />
      <DateTimeF name="scheduledPickupDate" label="Scheduled pickup date" disabled={Boolean(headerLock)} />
      <DateTimeF name="scheduledShipmentDate" label="Scheduled shipment date" disabled={Boolean(headerLock)} />
      <TextF name="storeOrderNumber" label="Store order #" maxLength={100} disabled={Boolean(headerLock)} info="The order number in the sales channel, if any." />
      <NumF name="priorityRank" label="Priority" min={0} max={9999} disabled={Boolean(headerLock)} info="Higher numbers are picked first. 1 Low · 2 Medium · 3 High · 4+ Urgent." />
      <FormGridFull>
        <AreaF name="note" label="Note" maxLength={NOTE_MAX} rows={3} placeholder="Notes for the warehouse team" />
      </FormGridFull>
    </FormGrid>
  );
}
