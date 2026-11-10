"use client";

/**
 * Step 1 — PO details. Two-column layout (Logiwa parity). The PO number is checked for
 * uniqueness inline (on blur and while typing, debounced) — Logiwa only checks at Confirm.
 * Client is locked on edit. Changing the client clears products and vendor of the old one.
 */
import * as React from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { CheckCircle2, Loader2 } from "lucide-react";
import { ClientSelect, WarehouseSelect } from "@/components/shared/entity-pickers";
import { FormField, FormGrid } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { apiRequest } from "@/lib/api-client";
import { PO_TYPES } from "@/lib/enums";
import { PO_CODE_MAX, PO_NOTE_MAX, PO_REFERENCE_MAX } from "@/lib/grid-defs/receiving/po-schemas";
import { AreaF, DateF, optionsOf, SelectF, TextF } from "../fields";
import { detailsStepSchema, type PoFormValues } from "./po-form-model";
import { useBlurValidation } from "./use-blur-validation";

const BLUR_FIELDS = ["warehouseId", "clientId", "code", "poType", "poDate", "referenceNumber", "note"] as const;

const PO_TYPE_OPTIONS = optionsOf(PO_TYPES);
const CHECK_DEBOUNCE_MS = 300;

type CheckState = "idle" | "checking" | "free" | "taken";

/** Inline PO number uniqueness: sets `codeConflict` (which step 1's schema turns into an error on `code`). */
export function useCodeCheck(form: UseFormReturn<PoFormValues>, excludeId: string | null) {
  const [state, setState] = React.useState<CheckState>("idle");
  const seq = React.useRef(0);
  const check = React.useCallback(async (raw: string) => {
    const code = raw.trim();
    const mine = ++seq.current;
    if (!code) {
      form.setValue("codeConflict", "");
      form.setValue("codeChecking", false);
      setState("idle");
      return;
    }
    setState("checking");
    // Block Next while the uniqueness check is in flight (Next must never outrun the check).
    form.setValue("codeChecking", true);
    try {
      const { data } = await apiRequest<{ taken: boolean; message: string | null }>("/api/purchase-orders/code-check", { query: { code, ...(excludeId ? { excludeId } : {}) } });
      if (mine !== seq.current) return;
      form.setValue("codeChecking", false);
      form.setValue("codeConflict", data.taken ? (data.message ?? "This purchase order code already exists") : "", { shouldValidate: true });
      if (data.taken) form.setError("code", { type: "server", message: data.message ?? "This purchase order code already exists" });
      else if (form.formState.errors.code?.type === "server" || form.formState.errors.code?.type === "step") void form.trigger("code");
      setState(data.taken ? "taken" : "free");
    } catch {
      if (mine === seq.current) {
        // A failed check must not block forever; the POST still rejects duplicates with 409.
        form.setValue("codeChecking", false);
        form.setValue("codeConflict", "", { shouldValidate: true });
        setState("idle");
      }
    }
  }, [form, excludeId]);
  // A restored draft may hold a check that never finished (page reloaded mid-check): re-run it.
  // Otherwise warm the check route once (a cold dev/edge route made the first answer take ~7 s),
  // so the result shows within about a second of blur.
  React.useEffect(() => {
    if (form.getValues("codeChecking")) void check(form.getValues("code") ?? "");
    else void apiRequest("/api/purchase-orders/code-check", { query: { code: "~warmup" } }).catch(() => undefined);
  }, [form, check]);
  return { state, check };
}

function CodeStatus({ state }: { readonly state: CheckState }) {
  // The reason Next is disabled is visible while the check runs, not only on hover.
  if (state === "checking") return <span className="flex items-center gap-1 whitespace-nowrap text-[11px] text-faint" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Checking…</span>;
  if (state === "taken") return <span className="whitespace-nowrap text-[11px] font-medium text-danger">Already exists</span>;
  if (state === "free") return <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-label="PO number is available" />;
  return null;
}

export function StepDetails({ form, editing, poId }: { readonly form: UseFormReturn<PoFormValues>; readonly editing: boolean; readonly poId: string | null }) {
  const warehouseId = useWatch({ control: form.control, name: "warehouseId" });
  const clientIdValue = useWatch({ control: form.control, name: "clientId" });
  const { state, check } = useCodeCheck(form, poId);
  useBlurValidation(form, detailsStepSchema, BLUR_FIELDS);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // The client the current lines / vendor belong to. A transient null (the picker reloading
  // its options, e.g. right after a draft restore) must never wipe the restored lines.
  const owner = React.useRef<string | null>(null);
  const changeClient = (next: string | null, label: string) => {
    const prev = form.getValues("clientId");
    if (owner.current === null) owner.current = prev || null;
    if (next === prev) return;
    if (!next || next === owner.current) {
      form.setValue("clientId", next ?? "", { shouldDirty: true, shouldValidate: true });
      form.setValue("clientLabel", next ? label : "");
      return;
    }
    owner.current = next;
    // Warm the vendor list for Step 3 while the user adds products.
    void apiRequest("/api/vendors", { query: { clientId: next, active: "1" } }).catch(() => undefined);
    const hadData = form.getValues("lines").length > 0 || Boolean(form.getValues("vendorId"));
    form.setValue("clientId", next ?? "", { shouldDirty: true, shouldValidate: true });
    form.setValue("clientLabel", label);
    if (hadData) {
      form.setValue("lines", [], { shouldDirty: true });
      form.setValue("vendorId", "", { shouldDirty: true });
      form.setValue("vendorLabel", "");
      toast.info("Products and vendor cleared", "They belonged to the previous client.");
    }
  };

  return (
    <FormGrid>
      <FormField name="warehouseId" label="Warehouse" required>
        {(c) => <WarehouseSelect id={c.id} value={(c.value as string) || null} onChange={(v) => c.onChange(v ?? "")} onBlur={c.onBlur} invalid={c.invalid} />}
      </FormField>
      <FormField name="clientId" label="Client" required={!editing} disabled={editing} info={editing ? "The client of a purchase order can't change." : undefined}
        description={!editing && !clientIdValue ? "Select a client to continue. Products and vendors are listed per client." : undefined}>
        {(c) => (
          <ClientSelect
            id={c.id}
            warehouseId={warehouseId || null}
            value={(c.value as string) || null}
            onChange={(v, opt) => changeClient(v, opt ? String(opt.label) : "")}
            onBlur={c.onBlur}
            invalid={c.invalid}
            disabled={c.disabled}
          />
        )}
      </FormField>
      <TextF
        name="code"
        label="PO number"
        required
        maxLength={PO_CODE_MAX}
        placeholder="Order code"
        info={`Must be unique, up to ${PO_CODE_MAX} characters. Checked as you type.`}
        trailing={<CodeStatus state={state} />}
        onValue={(v) => {
          form.setValue("codeConflict", "");
          form.setValue("codeChecking", Boolean(v.trim()));
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void check(v), CHECK_DEBOUNCE_MS);
        }}
        onBlurExtra={(v) => {
          if (timer.current) clearTimeout(timer.current);
          void check(v);
        }}
      />
      <SelectF name="poType" label="PO type" required options={PO_TYPE_OPTIONS} placeholder="Select purchase order type" info="Purchase Order: standard inbound, stock is put away after receiving. Non Crossdock: never routed to crossdock staging. Transfer Order: stock moving in from another warehouse. Return Order: customer returns. Open Order: a blanket order received in several deliveries." />
      <DateF name="poDate" label="PO date" required withTime />
      <DateF name="plannedReceivingDate" label="Planned receiving date" withTime />
      <DateF name="receivedAt" label="Actual receiving date" withTime info="Stamped automatically when the order is fully received." />
      <DateF name="plannedArrivalDate" label="Planned arrival date" withTime />
      <DateF name="actualArrivalDate" label="Actual arrival date" withTime />
      <TextF name="referenceNumber" label="Reference number" maxLength={PO_REFERENCE_MAX} info="Your vendor's order or invoice number." />
      <AreaF name="note" label="Note" maxLength={PO_NOTE_MAX} className="md:col-span-2" />
    </FormGrid>
  );
}
