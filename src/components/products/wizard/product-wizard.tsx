"use client";

/**
 * Product wizards A/B/C (spec 05 §1) on the shared `Wizard`:
 *   Product            General · Packing · Pack type · Advanced · Other info
 *   Kit                General · Components · Packing · Advanced · Other info
 *   Packaging material General · Packing · Other info
 * Create runs linear; edit runs free (every step clickable, Save anywhere) with the client locked.
 */
import * as React from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { apiFetch, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors } from "@/lib/query-client";
import { useCan } from "@/lib/permissions-client";
import type { ProductCategory } from "@/lib/grid-defs/products/catalog-options";
import {
  advancedStepSchema, componentsStepSchema, generalStepSchema, otherStepSchema, packTypesStepSchema, packingStepSchema, type ProductFormValues,
} from "@/lib/grid-defs/products/product-form";
import { useApiQuery } from "@/lib/query-client";
import { customFieldsQueryKey } from "@/components/shared/custom-fields-drawer";
import { CustomFieldsSection, type CustomFieldValues } from "@/components/shared/custom-fields-section";
import { toast } from "@/components/ui/toast";
import { Wizard, type WizardStep } from "@/components/ui/wizard";
import { ProductWizardProvider } from "./context";
import { StepAdvanced } from "./step-advanced";
import { StepComponents } from "./step-components";
import { StepGeneral } from "./step-general";
import { StepPackTypes } from "./step-pack-types";
import { StepPacking } from "./step-packing";
import { useFormContext, useWatch } from "react-hook-form";

type Values = ProductFormValues & { _skuTaken?: boolean };

/** General step + the inline SKU uniqueness flag. */
const generalWithSku = z.any().superRefine((v: Record<string, unknown>, ctx) => {
  const r = generalStepSchema.safeParse(v);
  if (!r.success) for (const i of r.error.issues) ctx.addIssue({ code: "custom", path: i.path, message: i.message });
  if (v._skuTaken) ctx.addIssue({ code: "custom", path: ["sku"], message: `SKU ${String(v.sku ?? "")} already exists for this client` });
});

const STEP_OF_FIELD: Readonly<Record<string, string>> = {
  clientId: "general", sku: "general", name: "general", description: "general", imageUrl: "general", barcode: "general", productTypeId: "general",
  productGroupId: "general", uom: "general", currency: "general", purchasePrice: "general", salesPrice: "general", taxRate: "general", kitType: "general",
  packTypes: "packTypes", components: "components", customFields: "other",
  packingInstructions: "packing", returnInstructions: "packing", weight: "packing", length: "packing", width: "packing", height: "packing", useShipPackageId: "packing",
};

function OtherInfo() {
  const form = useFormContext();
  const values = (useWatch({ name: "customFields" }) as CustomFieldValues | undefined) ?? {};
  const canManage = useCan("settings.products.custom_field_management").allowed;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-secondary">You can optionally add or edit custom fields under &ldquo;Other info&rdquo;. Values are filterable in the products grid.</p>
      <CustomFieldsSection entityType="product" values={values} canManage={canManage} onChange={(next) => form.setValue("customFields", { ...next }, { shouldDirty: true })} />
    </div>
  );
}

export interface ProductWizardProps {
  readonly category: ProductCategory;
  readonly mode: "create" | "edit";
  readonly defaultValues: Values;
  readonly productId?: string | null;
  readonly clientName?: string | null;
  readonly variant?: "page" | "drawer";
  readonly onSaved: (result: { id: string; sku: string; version: number }) => void;
  readonly onCancel?: () => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
  /** Disable the session draft (edit / duplicate). */
  readonly draftScope?: string | false;
  readonly guardUnsaved?: boolean;
  readonly className?: string;
}

/**
 * Drawer layout: the wizard fills the drawer body and its Cancel/Back/Next footer is pinned to
 * the drawer bottom on every step (opaque, top hairline, content scrolls above it), so the
 * primary button never moves between short and long steps. Pair with DRAWER_WIZARD_BODY on the
 * Drawer (no bottom padding, flex column).
 */
export const DRAWER_WIZARD_BODY = "flex flex-col pb-0";
export const DRAWER_WIZARD_CLASS = [
  "flex-1 [&>form]:flex-1",
  // Same numbered stepper as /products/new, tightened for the drawer width.
  "[&_nav[aria-label='Progress']_button]:min-w-0 [&_nav[aria-label='Progress']_button]:px-2 [&_nav[aria-label='Progress']_button]:gap-2",
  "[&_nav[aria-label='Progress']_li>span]:mx-1.5 [&_nav[aria-label='Progress']_li>span]:min-w-3",
  "[&>form>div:last-child]:mt-auto [&>form>div:last-child]:z-20 [&>form>div:last-child]:-mx-5 [&>form>div:last-child]:px-5 [&>form>div:last-child]:py-3",
  "[&>form>div:last-child]:shadow-[0_-1px_2px_rgba(16,24,40,0.05)]",
].join(" ");

/**
 * Page-variant stepper below `lg` (tablet): every step stays visible and clickable. Steps other
 * than the current one collapse to their numbered / check / icon circle (the accessible name
 * keeps "Step N: Label (status)"), the current step keeps its "Step N" + label, and connectors
 * tighten. Applied through the shared WizardStepper's markup (nav[aria-label=Progress]).
 */
export const PAGE_WIZARD_CLASS = [
  "max-lg:[&_nav[aria-label='Progress']_button]:min-w-0",
  "max-lg:[&_nav[aria-label='Progress']_button]:px-2",
  "max-lg:[&_nav[aria-label='Progress']_button:not([aria-current='step'])>span:last-child]:hidden",
  "max-lg:[&_nav[aria-label='Progress']_li>span]:mx-1.5",
  "max-lg:[&_nav[aria-label='Progress']_li>span]:min-w-3",
].join(" ");

export function buildSteps(category: ProductCategory, wrap: (node: React.ReactNode, ctx: { form: UseFormReturn<Values>; goTo: (k: string) => void }) => React.ReactNode): WizardStep<Values>[] {
  const step = (key: string, label: string, schema: z.ZodType | undefined, node: () => React.ReactNode, description?: string, isOptional?: boolean): WizardStep<Values> => ({
    key, label, schema, description, isOptional, render: (ctx) => wrap(node(), ctx),
  });
  const general = step("general", "General", generalWithSku, () => <StepGeneral />, category === "Kit" ? "Kit type, client, SKU and pricing" : "Client, SKU, naming and pricing");
  const packing = step("packing", "Packing", packingStepSchema, () => <StepPacking />, category === "Product" ? "Instructions and handling flags" : "Dimensions, instructions and handling flags");
  const other = step("other", "Other info", otherStepSchema, () => <OtherInfo />, "Custom fields", true);
  const advanced = step("advanced", "Advanced", advancedStepSchema, () => <StepAdvanced />, category === "Kit" ? "Customs, hazmat and channel allocation" : "Customs, tracking, hazmat, channel allocation and replenishment", true);
  if (category === "Kit") {
    return [general, step("components", "Components", componentsStepSchema, () => <StepComponents />, "Find and add the components that make up the kit"), packing, advanced, other];
  }
  if (category === "Packaging Material") return [general, packing, other];
  return [general, packing, step("packTypes", "Pack type", packTypesStepSchema, () => <StepPackTypes />, "Unit of measure, hierarchical and irregular packs with barcodes"), advanced, other];
}

export function toPayload(values: Values): Record<string, unknown> {
  const { _skuTaken: _ignored, ...rest } = values;
  void _ignored;
  return rest;
}

export function ProductWizard({ category, mode, defaultValues, productId = null, clientName = null, variant = "drawer", onSaved, onCancel, onDirtyChange, draftScope, guardUnsaved = false, className }: ProductWizardProps) {
  // Prefetch custom field definitions on mount so step "Other info" renders fields (or its empty state) immediately.
  useApiQuery<unknown>(customFieldsQueryKey("product"), "/api/custom-fields", { query: { entityType: "product" }, staleTime: 60_000 });
  const ctxRef = React.useRef<{ form: UseFormReturn<Values>; goTo: (k: string) => void } | null>(null);
  const steps = React.useMemo(() => buildSteps(category, (node, ctx) => {
    ctxRef.current = ctx;
    return <ProductWizardProvider category={category} mode={mode} productId={productId} clientName={clientName}>{node}</ProductWizardProvider>;
  }), [category, mode, productId, clientName]);

  const submit = async (values: Values) => {
    // In-flight guard: block tab close / reload while the POST is pending, and after 2 s tell the
    // user the save is still running so a slow server never looks like a dead button.
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    const slowId = `product-save-${Date.now()}`;
    const slowTimer = window.setTimeout(() => {
      toast.show({ id: slowId, variant: "info", title: "Still saving…", message: "The product is being saved. Keep this page open until it finishes.", duration: Infinity });
    }, 2000);
    const done = () => { window.clearTimeout(slowTimer); toast.dismiss(slowId); window.removeEventListener("beforeunload", onBeforeUnload); };
    try {
      const payload = toPayload(values);
      const result = mode === "create"
        ? await apiFetch<{ id: string; sku: string; version: number }>("/api/products", { method: "POST", body: payload })
        : await apiFetch<{ id: string; sku: string; version: number }>(`/api/products/${productId}`, { method: "PATCH", body: payload });
      done();
      toast.success("Success", mode === "create" ? "Product created successfully." : "Product updated successfully.");
      onSaved(result);
    } catch (error) {
      done();
      const ctx = ctxRef.current;
      if (isApiError(error) && error.code === "CONFLICT") {
        toast.error("This record changed since you opened it", "Reload to see the latest version before saving again.", {
          action: { label: "Reload", onClick: () => window.location.reload() },
          duration: Infinity,
        });
      } else {
        toast.error("Could not save the product", isApiError(error) ? error.message : "Something went wrong. Try again.");
      }
      if (ctx && isApiError(error)) {
        const first = Object.keys(error.fieldErrors)[0]?.split(".")[0];
        const stepKey = first ? STEP_OF_FIELD[first] ?? (["customs", "hazmat", "channelAllocations", "replenishmentLevels"].includes(first) ? "advanced" : undefined) : undefined;
        if (stepKey) ctx.goTo(stepKey);
        applyServerFieldErrors(ctx.form as unknown as UseFormReturn<FieldValues>, error);
      }
      throw error;
    }
  };

  return (
    <Wizard<Values>
      steps={steps}
      mode={mode === "create" ? "linear" : "free"}
      variant={variant}
      // One stepper style everywhere: numbered "STEP n" steps on the page and in the drawers.
      stepper="steps"
      defaultValues={defaultValues as never}
      onComplete={submit}
      onCancel={onCancel}
      submitLabel="Save"
      draftScope={draftScope ?? (mode === "create" ? `product-create:${category}` : false)}
      guardUnsaved={guardUnsaved}
      onDirtyChange={onDirtyChange}
      className={className ?? (variant === "drawer" ? DRAWER_WIZARD_CLASS : PAGE_WIZARD_CLASS)}
    />
  );
}
