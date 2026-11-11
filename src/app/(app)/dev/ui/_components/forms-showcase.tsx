"use client";

import * as React from "react";
import { z } from "zod";
import { ClipboardList, Package, Truck } from "lucide-react";
import { Form, FormField, FormGrid, FormGridFull, FormSection, SubmitBar, useZodForm } from "@/components/ui/form";
import { Wizard, RailRow, WizardSuccess, type WizardStep } from "@/components/ui/wizard";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { YesNoToggle } from "@/components/ui/yes-no-toggle";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ShowcaseSection, Specimen } from "./showcase-section";

const vendorSchema = z.object({
  code: z.string().trim().min(2, "Code needs at least 2 characters").max(20, "Use at most 20 characters"),
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")),
  leadTimeDays: z.number().int().min(0).max(365).nullable().refine((v) => v !== null, "Lead time is required"),
  isActive: z.boolean(),
  note: z.string().max(500).optional(),
});

function FormDemo() {
  const form = useZodForm(vendorSchema, { code: "", name: "", email: "", leadTimeDays: null, isActive: true, note: "" });
  return (
    <Form form={form} onSubmit={async (values) => { await new Promise((r) => setTimeout(r, 400)); toast.success("Saved", `Vendor ${values.code} saved.`); form.reset(values); }} className="space-y-4">
      <FormSection title="General" description="Inline errors appear under each field; Save focuses the first invalid one.">
        <FormGrid>
          <FormField<z.input<typeof vendorSchema>> name="code" label="Vendor code" required info="Unique per client">{(c) => <TextField {...c} value={c.value ?? ""} />}</FormField>
          <FormField<z.input<typeof vendorSchema>> name="name" label="Vendor name" required>{(c) => <TextField {...c} value={c.value ?? ""} />}</FormField>
          <FormField<z.input<typeof vendorSchema>> name="email" label="Email" description="Used for PO notifications">{(c) => <TextField {...c} type="email" value={c.value ?? ""} />}</FormField>
          <FormField<z.input<typeof vendorSchema>> name="leadTimeDays" label="Lead time (days)" required>{(c) => <NumberInput id={c.id} name={c.name} value={c.value ?? null} onChange={c.onChange} onBlur={c.onBlur} invalid={c.invalid} aria-invalid={c["aria-invalid"]} aria-describedby={c["aria-describedby"]} min={0} max={365} />}</FormField>
          <FormField<z.input<typeof vendorSchema>> name="isActive" label="Is active" inline>{(c) => <YesNoToggle id={c.id} value={c.value ?? null} onChange={c.onChange} ariaLabel="Is active" />}</FormField>
          <FormGridFull>
            <FormField<z.input<typeof vendorSchema>> name="note" label="Note">{(c) => <Textarea {...c} value={c.value ?? ""} maxLength={500} showCount />}</FormField>
          </FormGridFull>
        </FormGrid>
      </FormSection>
      <SubmitBar onCancel={() => form.reset()} />
    </Form>
  );
}

interface KitValues {
  readonly sku: string;
  readonly name: string;
  readonly uom: string;
  readonly componentCount: number | null;
  readonly carrier: string;
}

const KIT_STEPS: readonly WizardStep<KitValues>[] = [
  {
    key: "general",
    label: "General",
    icon: Package,
    schema: z.object({ sku: z.string().trim().min(1, "SKU is required").min(3, "SKU needs at least 3 characters"), name: z.string().trim().min(1, "Name is required") }),
    render: () => (
      <FormGrid>
        <FormField<KitValues> name="sku" label="SKU" required>{(c) => <TextField {...c} value={c.value ?? ""} />}</FormField>
        <FormField<KitValues> name="name" label="Product name" required>{(c) => <TextField {...c} value={c.value ?? ""} />}</FormField>
      </FormGrid>
    ),
  },
  {
    key: "components",
    label: "Kit",
    icon: ClipboardList,
    schema: z.object({ componentCount: z.number({ error: "Enter how many components" }).int().min(2, "A kit needs at least 2 components"), uom: z.string().min(1, "Select a unit") }),
    render: () => (
      <FormGrid>
        <FormField<KitValues> name="componentCount" label="Components" required>{(c) => <NumberInput id={c.id} value={c.value ?? null} onChange={c.onChange} onBlur={c.onBlur} invalid={c.invalid} aria-invalid={c["aria-invalid"]} min={0} />}</FormField>
        <FormField<KitValues> name="uom" label="Unit of measure" required>{(c) => <Select id={c.id} value={c.value || null} onChange={(v) => c.onChange(v ?? "")} onBlur={c.onBlur} invalid={c.invalid} options={[{ value: "EA", label: "Each" }, { value: "CS", label: "Case" }]} placeholder="Select unit" />}</FormField>
      </FormGrid>
    ),
  },
  {
    key: "shipping",
    label: "Shipping",
    icon: Truck,
    isOptional: true,
    render: () => (
      <FormField<KitValues> name="carrier" label="Preferred carrier">{(c) => <TextField {...c} value={c.value ?? ""} placeholder="e.g. UPS Ground" />}</FormField>
    ),
  },
];

const KIT_DEFAULTS: KitValues = { sku: "", name: "", uom: "", componentCount: null, carrier: "" };

type WizardDemoMode = "linear" | "free";

function WizardDemo() {
  const [mode, setMode] = React.useState<WizardDemoMode>("linear");
  const [runId, setRunId] = React.useState(0);
  const [dirty, setDirty] = React.useState(false);
  const [pendingMode, setPendingMode] = React.useState<WizardDemoMode | null>(null);
  const switchTo = (next: WizardDemoMode): void => {
    setDirty(false);
    setMode(next);
    setRunId((n) => n + 1);
  };
  return (
    <div className="space-y-3">
      {/* Switching remounts the wizard with that mode's record, so typed data is never dropped silently. */}
      <SegmentedControl ariaLabel="Wizard mode" value={mode} onChange={(m) => (m === mode ? undefined : dirty ? setPendingMode(m) : switchTo(m))} options={[{ value: "linear", label: "Linear (create)" }, { value: "free", label: "Free (edit)" }]} />
      <ConfirmDialog
        open={pendingMode !== null}
        onOpenChange={(open) => (open ? undefined : setPendingMode(null))}
        variant="attention"
        title="Discard what you entered?"
        description={pendingMode === "free" ? "Free (edit) mode opens an existing kit, so the values typed in this create flow are discarded." : "Linear (create) mode starts a new kit, so your edits are discarded."}
        cancelLabel="Keep editing"
        confirmLabel="Discard and switch"
        onConfirm={() => {
          if (pendingMode) switchTo(pendingMode);
          setPendingMode(null);
        }}
      />
      <Wizard<KitValues>
        key={`${mode}-${runId}`}
        onDirtyChange={setDirty}
        steps={KIT_STEPS}
        mode={mode}
        defaultValues={mode === "free" ? { ...KIT_DEFAULTS, sku: "KIT-STARTER", name: "Starter Kit", uom: "EA", componentCount: 3 } : KIT_DEFAULTS}
        draftScope={false}
        guardUnsaved={false}
        submitLabel={mode === "free" ? "Save" : "Create product"}
        onCancel={() => setRunId((n) => n + 1)}
        onComplete={async (values) => { await new Promise((r) => setTimeout(r, 400)); toast.success("Success", `${values.sku} saved.`); }}
        railTitle="Product summary"
        railSummary={(values) => (
          <div className="space-y-1.5 text-xs">
            <RailRow label="SKU">{values.sku || "—"}</RailRow>
            <RailRow label="Name">{values.name || "—"}</RailRow>
            <RailRow label="Components">{values.componentCount ?? "—"}</RailRow>
          </div>
        )}
        success={<WizardSuccess entity="the kit product" options={[{ title: "Create another", description: "Start a new product", onClick: () => setRunId((n) => n + 1) }, { title: "Open products", href: "/products" }]} />}
      />
    </div>
  );
}

function DrawerWizardDemo() {
  return (
    <div className="max-w-[560px] rounded-lg border border-border p-4">
      <Wizard<KitValues> steps={KIT_STEPS} variant="drawer" defaultValues={KIT_DEFAULTS} draftScope={false} guardUnsaved={false} onComplete={() => toast.success("Success", "Drawer wizard complete.")} />
    </div>
  );
}

export function FormsShowcase() {
  return (
    <>
      <ShowcaseSection id="forms" title="Forms" description="useZodForm + FormField + SubmitBar: required *, info tips, inline errors, disabled Save with a reason.">
        <FormDemo />
      </ShowcaseSection>
      <ShowcaseSection id="wizard" title="Wizard" description="Linear mode (create) locks unreached steps; free mode (edit) makes every step clickable. Validation runs per step.">
        <Specimen label="Page variant (stepper + rail)"><div className="w-full"><WizardDemo /></div></Specimen>
        <Specimen label="Drawer variant (pills)"><DrawerWizardDemo /></Specimen>
      </ShowcaseSection>
    </>
  );
}
