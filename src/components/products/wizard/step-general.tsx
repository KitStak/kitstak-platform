"use client";

import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { CheckCircle2, ImageIcon, Lock } from "lucide-react";
import { apiFetch, isApiError } from "@/lib/api-client";
import { useCan } from "@/lib/permissions-client";
import { CURRENCIES, CURRENCY_LABELS, KIT_TYPES } from "@/lib/grid-defs/products/catalog-options";
import { BARCODE_MAX, DESCRIPTION_MAX, NAME_MAX, SKU_MAX } from "@/lib/grid-defs/products/product-form";
import { Combobox } from "@/components/ui/combobox";
import { FieldLabel, FormField, FormGrid, FormGridFull } from "@/components/ui/form";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useProductWizard } from "./context";
import { NumF, SelectF, TextF, YesNoF, opts } from "./fields";

const SKU_CHECK_DELAY_MS = 350;

type SkuState = "idle" | "checking" | "ok" | "taken";

/** Debounced per-client SKU uniqueness check; flags `_skuTaken` so Next is blocked inline. */
function useSkuCheck(): SkuState {
  const { mode, productId } = useProductWizard();
  const form = useFormContext();
  const clientId = useWatch({ name: "clientId" }) as string;
  const sku = (useWatch({ name: "sku" }) as string | undefined)?.trim() ?? "";
  const [state, setState] = React.useState<SkuState>("idle");
  React.useEffect(() => {
    if (!clientId || !sku) {
      setState("idle");
      form.setValue("_skuTaken", false);
      return undefined;
    }
    setState("checking");
    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiFetch<{ available: boolean }>("/api/products/check-sku", { query: { clientId, sku, excludeId: mode === "edit" ? productId ?? undefined : undefined }, signal: controller.signal })
        .then((r) => {
          setState(r.available ? "ok" : "taken");
          form.setValue("_skuTaken", !r.available);
          if (!r.available) form.setError("sku", { type: "duplicate", message: `SKU ${sku} already exists for this client` });
          else if (form.getFieldState("sku").error?.type === "duplicate") form.clearErrors("sku");
        })
        .catch(() => setState("idle"));
    }, SKU_CHECK_DELAY_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [clientId, sku, mode, productId, form]);
  return state;
}

function SkuTrailing({ state }: { readonly state: SkuState }) {
  if (state === "checking") return <Spinner className="h-3.5 w-3.5" label="Checking SKU" />;
  if (state === "ok") return <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-label="SKU is available" />;
  return null;
}

function LookupField({ name, label, type }: { readonly name: "productTypeId" | "productGroupId"; readonly label: string; readonly type: "product_type" | "product_group" }) {
  const { options, refetchOptions } = useProductWizard();
  const clientId = useWatch({ name: "clientId" }) as string;
  const canCreate = useCan("settings.data_setup.view").allowed;
  const list = name === "productTypeId" ? options.productTypes : options.productGroups;
  const noun = label.toLowerCase();
  return (
    <FormField name={name} label={label} info={`${label}s are defined per client.`}>
      {(c) => (
        <Combobox
          id={c.id}
          value={(c.value as string | null) ?? null}
          onChange={(v) => c.onChange(v)}
          onBlur={c.onBlur}
          invalid={c.invalid}
          disabled={!clientId}
          clearable
          placeholder={clientId ? `Select ${noun}` : "Select a client first"}
          emptyText={`No ${noun} found.`}
          options={list.map((o) => ({ value: o.value, label: o.label }))}
          creatable={canCreate && Boolean(clientId)}
          onCreate={async (input) => {
            try {
              const row = await apiFetch<{ id: string; name: string }>(`/api/lookups/${type}`, { method: "POST", body: { name: input, clientId } });
              refetchOptions();
              toast.success("Created", `${label} "${row.name}" was added for this client.`);
              return { value: row.id, label: row.name };
            } catch (error) {
              toast.error("Could not create", isApiError(error) ? error.message : `The ${noun} could not be created.`);
              throw error;
            }
          }}
          aria-label={label}
        />
      )}
    </FormField>
  );
}

function ImagePreview() {
  const url = (useWatch({ name: "imageUrl" }) as string | undefined)?.trim() ?? "";
  const [failed, setFailed] = React.useState(false);
  const valid = /^https?:\/\/\S+$/i.test(url);
  React.useEffect(() => setFailed(false), [url]);
  return (
    <span className="flex h-[66px] w-[66px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-sunken" aria-label="Image preview">
      {valid && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- product images come from arbitrary CDNs
        <img src={url} alt="" width={66} height={66} className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <ImageIcon className="h-5 w-5 text-faint" aria-hidden />
      )}
    </span>
  );
}

export function StepGeneral() {
  const { category, mode, clientName, options } = useProductWizard();
  const form = useFormContext();
  const currency = (useWatch({ name: "currency" }) as string) || "USD";
  const kitType = useWatch({ name: "kitType" }) as string | null;
  const skuState = useSkuCheck();
  const isPackaging = category === "Packaging Material";
  const showBarcode = category !== "Product";

  return (
    <FormGrid columns={2}>
      {category === "Kit" ? (
        <FormGridFull>
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Kit type</FieldLabel>
            <SegmentedControl
              ariaLabel="Kit type"
              value={(kitType ?? "Kit to Order") as (typeof KIT_TYPES)[number]}
              onChange={(v) => form.setValue("kitType", v, { shouldDirty: true })}
              options={KIT_TYPES.map((k) => ({ value: k, label: k }))}
            />
            <p className="text-[12px] text-secondary">
              {kitType === "Kit to Stock" ? "Assembled ahead of demand through work orders and stocked as its own SKU." : "Assembled per order from its components at pick time."}
            </p>
          </div>
        </FormGridFull>
      ) : null}
      {mode === "edit" ? (
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Client</FieldLabel>
          <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface-sunken px-2.5 text-[13px] text-body" title="The client cannot be changed after creation">
            <Lock className="h-3.5 w-3.5 text-faint" aria-hidden />
            {clientName}
          </div>
        </div>
      ) : (
        <SelectF name="clientId" label="Client" required placeholder="Select client" options={options.clients.map((c) => ({ value: c.value, label: c.label, description: c.description }))}
          onValue={() => {
            form.setValue("productTypeId", null);
            form.setValue("productGroupId", null);
            form.setValue("components", []);
            form.setValue("channelAllocations", []);
          }}
        />
      )}
      <TextF name="sku" label="SKU (stock keeping unit)" required maxLength={SKU_MAX} placeholder="Enter SKU" trailing={<SkuTrailing state={skuState} />} info="Unique per client. The same SKU can exist under another client." />
      <FormGridFull>
        <TextF name="name" label="Name" required maxLength={NAME_MAX} placeholder="Enter name" />
      </FormGridFull>
      <FormGridFull>
        <TextF name="description" label="Description" maxLength={DESCRIPTION_MAX} placeholder="Enter description" />
      </FormGridFull>
      <FormGridFull>
        <div className="flex items-start gap-3">
          <ImagePreview />
          <TextF name="imageUrl" label="Product image" placeholder="Paste URL address of the image to add" className="min-w-0 flex-1" />
        </div>
      </FormGridFull>
      {showBarcode ? <TextF name="barcode" label="Product barcode" maxLength={BARCODE_MAX} placeholder="Enter product barcode" /> : null}
      {showBarcode ? <SelectF name="uom" label="UOM pack type" required options={options.packTypes.map((o) => ({ value: o.value, label: o.label }))} /> : null}
      <LookupField name="productTypeId" label="Product type" type="product_type" />
      <LookupField name="productGroupId" label="Product group" type="product_group" />
      <SelectF name="currency" label="Currency" options={opts(CURRENCIES, CURRENCY_LABELS)} />
      <NumF name="purchasePrice" label="Purchase price" decimals={2} suffix={currency} />
      {isPackaging ? null : <NumF name="salesPrice" label="Sales price" decimals={2} suffix={currency} />}
      {isPackaging ? null : <NumF name="taxRate" label="Tax rate" decimals={2} max={100} suffix="%" />}
      <NumF name="minSafetyStock" label="Minimum safety stock" info="Replenishment and low-stock alerts trigger below this quantity." />
      <TextF name="fnsku" label="FNSKU" maxLength={BARCODE_MAX} placeholder="Amazon fulfillment network SKU" />
      <YesNoF name="isActive" label="Active?" />
      {isPackaging ? null : <YesNoF name="isDigital" label="Digital?" info="Digital products are never picked or packed." />}
    </FormGrid>
  );
}
