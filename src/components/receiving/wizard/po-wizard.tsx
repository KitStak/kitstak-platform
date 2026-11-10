"use client";

/**
 * Purchase order wizard (5 steps). Create (`/receiving/new`, linear) and detail / edit
 * (`/receiving/[id]`, free: every step clickable, opens on Confirm, client locked).
 * The right rail shows the PO status ring, a live price total and Confirm / Save.
 */
import * as React from "react";
import type { UseFormReturn } from "react-hook-form";
import { Building2, ClipboardList, FileCheck2, History, ListChecks, Package, Plus, Settings2 } from "lucide-react";
import { RailRow, Wizard, WizardSuccess, type WizardStep } from "@/components/ui/wizard";
import { toast } from "@/components/ui/toast";
import { apiRequest, isApiError } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { applyServerFieldErrors } from "@/lib/query-client";
import { errorMessage, useInvalidateReceiving, type PoDetail } from "../receiving-shared";
import { detailsStepSchema, emptyValues, linesQty, linesTotal, productsStepSchema, skuCount, toPayload, valuesFromDetail, vendorStepSchema, type PoFormValues } from "./po-form-model";
import { StepConfirm, StepOther } from "./step-confirm";
import { StepDetails } from "./step-details";
import { StepProducts } from "./step-products";
import { StepVendor } from "./step-vendor";

export const PO_RAIL_HINT = "Follow all the steps to complete purchase order";
const CLOSED = new Set(["Completed", "Cancelled"]);

/** Jumps once to `target` after mount (edit opens on Confirm, or on `?step=`). */
function InitialStep({ goTo, target, doneRef }: { readonly goTo: (key: string) => void; readonly target: string; readonly doneRef: React.MutableRefObject<boolean> }) {
  React.useEffect(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (target !== "details") goTo(target);
  }, [goTo, target, doneRef]);
  return null;
}

export interface PoWizardProps {
  readonly po: PoDetail | null;
  /** Step to open on in edit mode (default Confirm). */
  readonly initialStep?: string;
  /** Extra rail content (detail page: other actions, summary, billing, printouts). */
  readonly railExtra?: React.ReactNode;
  readonly onSaved?: (po: PoDetail) => void;
  readonly defaults?: { readonly warehouseId?: string | null; readonly clientId?: string | null };
  /** Create mode: "Create another" success card. */
  readonly onCreateAnother?: () => void;
}

export function PoWizard({ po, initialStep = "confirm", railExtra, onSaved, defaults, onCreateAnother }: PoWizardProps) {
  const fmt = useFormat();
  const invalidate = useInvalidateReceiving();
  const editing = po !== null;
  const closed = po ? CLOSED.has(po.status) : false;
  const formRef = React.useRef<UseFormReturn<PoFormValues> | null>(null);
  const jumped = React.useRef(false);
  const [duplicate, setDuplicate] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<PoDetail | null>(null);
  const defaultValues = React.useMemo(() => (po ? valuesFromDetail(po) : emptyValues(defaults)), [po, defaults]);

  const bind = (form: UseFormReturn<PoFormValues>) => {
    formRef.current = form;
  };

  const steps: readonly WizardStep<PoFormValues>[] = [
    {
      key: "details", label: "PO details", icon: ClipboardList, schema: detailsStepSchema, description: "Warehouse, client, number, type and dates.",
      render: ({ form, goTo }) => {
        bind(form);
        return (
          <>
            {editing ? <InitialStep goTo={goTo} target={initialStep} doneRef={jumped} /> : null}
            <StepDetails form={form} editing={editing} poId={po?.id ?? null} />
          </>
        );
      },
    },
    {
      key: "products", label: "Products", icon: Package, schema: productsStepSchema, description: closed ? "Lines of a closed purchase order can't change." : "Search the client's products and set quantity and price.",
      render: ({ form }) => {
        bind(form);
        return <StepProducts form={form} readOnly={closed} />;
      },
    },
    {
      key: "vendor", label: "Vendor", icon: Building2, schema: vendorStepSchema, description: "Exactly one vendor of the client.",
      render: ({ form }) => {
        bind(form);
        return <StepVendor form={form} />;
      },
    },
    {
      key: "other", label: "Other info", icon: Settings2, isOptional: true,
      render: ({ form }) => {
        bind(form);
        return <StepOther form={form} disabled={false} />;
      },
    },
    {
      key: "confirm", label: "Confirm", icon: FileCheck2, description: editing ? "Review the order. Click any step to change it." : "Review and confirm the purchase order.",
      render: ({ form, goTo }) => {
        bind(form);
        return (
          <>
            {editing ? <InitialStep goTo={goTo} target={initialStep} doneRef={jumped} /> : null}
            <StepConfirm form={form} duplicate={duplicate} onDismissDuplicate={() => setDuplicate(null)} goTo={goTo} receiving={Boolean(po && po.receivedQuantity > 0)} />
          </>
        );
      },
    },
  ];

  const submit = async (values: PoFormValues) => {
    setDuplicate(null);
    try {
      const body = toPayload(values, po?.version);
      if (po) {
        const { data } = await apiRequest<PoDetail>(`/api/purchase-orders/${po.id}`, { method: "PATCH", body: { ...body, clientId: undefined } });
        toast.success("Success", `Purchase order ${data.code} saved.`);
        await invalidate();
        onSaved?.(data);
      } else {
        const { data } = await apiRequest<PoDetail>("/api/purchase-orders", { method: "POST", body });
        setCreated(data);
        await invalidate();
      }
    } catch (error) {
      const form = formRef.current;
      if (isApiError(error) && error.code === "DUPLICATE") {
        setDuplicate(error.message);
        form?.setValue("codeConflict", error.message);
      } else if (form) {
        applyServerFieldErrors(form, error);
      }
      toast.error("Error", errorMessage(error));
      throw error;
    }
  };

  const railSummary = (v: PoFormValues) => (
    <>
      <p className="text-[12px] text-secondary">{PO_RAIL_HINT}</p>
      <div className="rounded-md bg-surface-sunken px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">Price</p>
        <p className="text-[20px] font-bold tabular-nums text-foreground" aria-live="polite">Total {fmt.money(linesTotal(v.lines ?? []))}</p>
      </div>
      <RailRow label="PO number">{v.code || "—"}</RailRow>
      <RailRow label="Client">{v.clientLabel || (po?.clientName ?? "—")}</RailRow>
      <RailRow label="Vendor">{v.vendorLabel || "—"}</RailRow>
      <RailRow label="Number of SKU">{skuCount(v.lines ?? [])}</RailRow>
      <RailRow label="Total qty">{linesQty(v.lines ?? []).toLocaleString()}</RailRow>
      {railExtra}
    </>
  );

  const success = created ? (
    <div className="rounded-lg border border-border bg-surface p-8 shadow-xs">
      <WizardSuccess
        entity={<>a new purchase order: <a className="text-primary hover:underline" href={`/receiving/${created.id}`}>{created.code}</a></>}
        verb="created"
        description={`${created.lines.length} line${created.lines.length === 1 ? "" : "s"} · ${created.totalQuantity.toLocaleString()} units · ${fmt.money(created.purchasePrice)} · status Pending`}
        options={[
          { title: "Go back to purchase order list", description: "Turn to the purchase order screen to see a full list of orders.", icon: ListChecks, href: "/receiving" },
          { title: "Create another purchase order", description: "Turn to the create order form to create another purchase order.", icon: Plus, onClick: onCreateAnother },
          { title: "Check the PO receiving history", description: "Control the received purchase order history to see pending and received quantities.", icon: History, href: "/receiving/history" },
        ]}
      />
    </div>
  ) : null;

  return (
    <Wizard<PoFormValues>
      steps={steps}
      mode={editing ? "free" : "linear"}
      defaultValues={defaultValues}
      onComplete={submit}
      submitLabel={editing ? "Save purchase order" : "Confirm purchase order"}
      draftScope={editing ? false : undefined}
      railTitle="PO status"
      railSummary={railSummary}
      success={success}
    />
  );
}
