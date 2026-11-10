/**
 * Create/Edit Work Order wizard state (pure, unit-tested): the form shape, the conversion
 * into the API input (`workOrderInputSchema`) and per-step validation with the exact field
 * keys the steps render (`data-field`), so the wizard can jump to and focus the first error.
 */
import { workOrderInputSchema, type BuildFor, type WorkOrderInput, type WorkOrderType } from "@/lib/grid-defs/work-orders/work-order-model";

export type WizardStepKey = "general" | "kit" | "advanced" | "other";
export const WIZARD_STEPS: readonly { readonly key: WizardStepKey; readonly label: string }[] = [
  { key: "general", label: "General" },
  { key: "kit", label: "Kit" },
  { key: "advanced", label: "Advanced" },
  { key: "other", label: "Other Info" },
];

export interface SourceForm {
  readonly locationId: string | null;
  readonly locationCode: string | null;
  readonly lpId: string | null;
  readonly lpNumber: string | null;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
}

export const EMPTY_SOURCE: SourceForm = { locationId: null, locationCode: null, lpId: null, lpNumber: null, lotNumber: null, expiryDate: null, productionDate: null };

export interface WoForm {
  readonly warehouseId: string | null;
  readonly clientId: string | null;
  readonly code: string;
  readonly type: WorkOrderType | null;
  readonly extraNote: string;
  readonly buildFor: BuildFor;
  readonly shipmentOrderId: string | null;
  readonly shipmentOrderCode: string | null;
  readonly kitProductId: string | null;
  readonly kitSku: string | null;
  readonly requestedQty: number | null;
  /** Keyed by component product id. */
  readonly sources: Readonly<Record<string, SourceForm>>;
  readonly kittingInstructions: string;
  readonly plannedStartAt: Date | null;
  readonly plannedFinishAt: Date | null;
  readonly actualStartAt: Date | null;
  readonly actualFinishAt: Date | null;
  readonly customFields: Readonly<Record<string, string | boolean | null>>;
}

export const EMPTY_FORM: WoForm = {
  warehouseId: null, clientId: null, code: "", type: null, extraNote: "", buildFor: "Stock", shipmentOrderId: null, shipmentOrderCode: null,
  kitProductId: null, kitSku: null, requestedQty: 1, sources: {}, kittingInstructions: "",
  plannedStartAt: null, plannedFinishAt: null, actualStartAt: null, actualFinishAt: null, customFields: {},
};

export type FormErrors = Readonly<Record<string, string>>;

/** Which step renders a field key (server field errors are mapped back through this). */
export function stepOfField(key: string): WizardStepKey {
  if (["warehouseId", "clientId", "code", "type", "extraNote", "buildFor", "shipmentOrderId"].includes(key)) return "general";
  if (key === "kitProductId" || key === "requestedQty" || key.startsWith("components")) return "kit";
  if (key.startsWith("customFields")) return "other";
  return "advanced";
}

export const FIELD_ORDER: readonly string[] = [
  "warehouseId", "clientId", "code", "type", "shipmentOrderId", "kitProductId", "requestedQty",
  "plannedStartAt", "plannedFinishAt", "actualStartAt", "actualFinishAt",
];

export function toInput(form: WoForm, componentIds: readonly string[]): unknown {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    warehouseId: form.warehouseId ?? "", clientId: form.clientId ?? "", code: form.code.trim(), type: form.type ?? undefined,
    extraNote: form.extraNote.trim() || null, buildFor: form.buildFor, shipmentOrderId: form.buildFor === "SO" ? form.shipmentOrderId : null,
    kitProductId: form.kitProductId ?? "", requestedQty: form.requestedQty ?? undefined,
    components: componentIds.map((id) => {
      const s = form.sources[id] ?? EMPTY_SOURCE;
      return { componentProductId: id, locationId: s.locationId, lpId: s.lpId, lotNumber: s.lotNumber, expiryDate: s.expiryDate, productionDate: s.productionDate };
    }),
    kittingInstructions: form.kittingInstructions.trim() || null,
    plannedStartAt: iso(form.plannedStartAt), plannedFinishAt: iso(form.plannedFinishAt), actualStartAt: iso(form.actualStartAt), actualFinishAt: iso(form.actualFinishAt),
    customFields: form.customFields,
  };
}

export interface ComponentInfo { readonly productId: string; readonly sku: string }

export const NO_COMPONENTS_PREFIX = "The kit has no components";

/** Full validation, grouped by field key; the kit step also checks "without picking" sources. */
export function validateForm(form: WoForm, components: readonly ComponentInfo[], opts: { readonly componentsLoaded?: boolean } = {}): { readonly ok: true; readonly input: WorkOrderInput } | { readonly ok: false; readonly errors: FormErrors } {
  const parsed = workOrderInputSchema.safeParse(toInput(form, components.map((c) => c.productId)));
  const errors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (!errors[key]) errors[key] = issue.message;
    }
  }
  // Only once the selected kit's components loaded: while it loads, "no components" would be a stale error.
  if (form.kitProductId && components.length === 0 && opts.componentsLoaded !== false) errors.kitProductId = errors.kitProductId ?? `${NO_COMPONENTS_PREFIX}; add them on the product first`;
  if (form.type === "Work Order without Picking") {
    for (const c of components) {
      if (!form.sources[c.productId]?.locationId) errors[`components.${c.productId}`] = `Choose a source location for ${c.sku}`;
    }
  }
  if (Object.keys(errors).length > 0 || !parsed.success) return { ok: false, errors };
  return { ok: true, input: parsed.data };
}

/** Errors that belong to `step`. */
export function errorsForStep(errors: FormErrors, step: WizardStepKey): FormErrors {
  return Object.fromEntries(Object.entries(errors).filter(([k]) => stepOfField(k) === step));
}

export function firstErrorKey(errors: FormErrors): string | null {
  const keys = Object.keys(errors);
  return FIELD_ORDER.find((k) => keys.includes(k)) ?? keys[0] ?? null;
}

export const FIELD_LABELS: Readonly<Record<string, string>> = {
  warehouseId: "Warehouse", clientId: "Client", code: "Work order code", type: "Work order type", shipmentOrderId: "Shipment order",
  extraNote: "Extra note", kitProductId: "Kit SKU", requestedQty: "Kit quantity",
  plannedStartAt: "Planned start date", plannedFinishAt: "Planned finish date", actualStartAt: "Actual start date", actualFinishAt: "Actual finish date",
  kittingInstructions: "Kitting instructions",
};

/** State of the kit fetch the Kit step depends on (the wizard owns the query). */
export interface KitLoadState {
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * Why Next must stay disabled on `step` (Logiwa keeps Next disabled until the step is valid),
 * or null when the step can be left. Pure: the reason is shown as the disabled button's tooltip.
 */
export function stepBlockReason(form: WoForm, components: readonly ComponentInfo[], step: WizardStepKey, kitState: KitLoadState = { loading: false, error: null }): string | null {
  if (step === "kit") {
    if (!form.clientId) return "Select a client in step 1 first";
    if (!form.kitProductId) return "Select a kit to continue";
    if (kitState.error) return "The kit couldn't be loaded. Retry to continue";
    if (kitState.loading) return "Loading the kit and its components…";
  }
  const res = validateForm(form, components);
  if (res.ok) return null;
  const keys = Object.keys(errorsForStep(res.errors, step));
  if (keys.length === 0) return null;
  const ordered = [...keys].sort((a, b) => {
    const ia = FIELD_ORDER.indexOf(a); const ib = FIELD_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const sourceKeys = ordered.filter((k) => k.startsWith("components"));
  if (step === "kit" && ordered.length === sourceKeys.length && sourceKeys.length > 0) {
    return `Choose a source for ${sourceKeys.length} component${sourceKeys.length === 1 ? "" : "s"}`;
  }
  const labels = [...new Set(ordered.map((k) => (k.startsWith("components") ? "Component sources" : FIELD_LABELS[k] ?? k)))];
  if (labels.length > 1) return `Complete ${labels.join(", ")}`;
  const label = labels[0] ?? "";
  const message = res.errors[ordered[0] ?? ""] ?? "is required";
  return message.toLowerCase().startsWith(label.toLowerCase()) ? message : `${label}: ${message}`;
}

/** Shallow structural equality used by the unsaved-changes guard. */
export function formsEqual(a: WoForm, b: WoForm): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
