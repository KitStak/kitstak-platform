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
import type { PoFormValues } from "./po-form-model";

const PO_TYPE_OPTIONS = optionsOf(PO_TYPES);
const CHECK_DEBOUNCE_MS = 400;

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
      setState("idle");
      return;
    }
    setState("checking");
    try {
      const { data } = await apiRequest<{ taken: boolean; message: string | null }>("/api/purchase-orders/code-check", { query: { code, ...(excludeId ? { excludeId } : {}) } });
      if (mine !== seq.current) return;
      form.setValue("codeConflict", data.taken ? (data.message ?? "This purchase order code already exists") : "");
      if (data.taken) form.setError("code", { type: "server", message: data.message ?? "This purchase order code already exists" });
      else if (form.formState.errors.code?.type === "server" || form.formState.errors.code?.type === "step") void form.trigger("code");
      setState(data.taken ? "taken" : "free");
    } catch {
      if (mine === seq.current) setState("idle");
    }
  }, [form, excludeId]);
  return { state, check };
}

function CodeStatus({ state }: { readonly state: CheckState }) {
  if (state === "checking") return <Loader2 className="h-3.5 w-3.5 animate-spin text-faint" aria-label="Checking PO number" />;
  if (state === "free") return <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-label="PO number is available" />;
  return null;
}

export function StepDetails({ form, editing, poId }: { readonly form: UseFormReturn<PoFormValues>; readonly editing: boolean; readonly poId: string | null }) {
  const warehouseId = useWatch({ control: form.control, name: "warehouseId" });
  const { state, check } = useCodeCheck(form, poId);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const changeClient = (next: string | null, label: string) => {
    const prev = form.getValues("clientId");
    if (next === prev) return;
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
      <FormField name="clientId" label="Client" required={!editing} disabled={editing} info={editing ? "The client of a purchase order can't change." : undefined}>
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
        info="Must be unique. Checked as you type."
        trailing={<CodeStatus state={state} />}
        onValue={(v) => {
          form.setValue("codeConflict", "");
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void check(v), CHECK_DEBOUNCE_MS);
        }}
        onBlurExtra={(v) => {
          if (timer.current) clearTimeout(timer.current);
          void check(v);
        }}
      />
      <SelectF name="poType" label="PO type" required options={PO_TYPE_OPTIONS} placeholder="Select purchase order type" info="Purchase order types are configured per tenant." />
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
