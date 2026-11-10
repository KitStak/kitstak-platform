"use client";

/**
 * Create / Edit Client drawer (4 steps): 1. Information (display + official name, code,
 * status, contact) · 2. Settings (currency + 28 switches in 4 groups, each with a
 * description tooltip and a group "turn all on/off") · 3. Addresses (multi-address modal,
 * usage type + default) · 4. Others (tax ID, SSCC-18, custom fields, note; pricing lives on 3PL billing forms).
 */
import * as React from "react";
import { Building2, FileText, MapPin, SlidersHorizontal } from "lucide-react";
import { useFormContext, useWatch, type UseFormReturn } from "react-hook-form";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import { ACTIVE_STATUSES, CURRENCIES } from "@/lib/enums";
import {
  CLIENT_DEFAULTS, CLIENT_SETTING_GROUPS, EMPTY_SSCC, clientInfoSchema, clientOthersSchema, clientSettingsStepSchema, enabledSwitchCount, previewSscc, suggestClientCode, type ClientInput, type ClientSettingsForm,
} from "@/lib/grid-defs/organization/clients";
import { clientAddressesStepSchema } from "@/lib/grid-defs/organization/clients";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField, FormGrid, FormSection } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/info-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { Wizard, type WizardStep } from "@/components/ui/wizard";
import { useFrozenWhileDirty } from "@/components/organization/use-stable-form-key";
import { CustomFieldsSection, type CustomFieldValues } from "@/components/shared/custom-fields-section";
import { SelectField, TextInput } from "@/components/facility/form-controls";
import { AddressesField } from "@/components/organization/addresses-editor";
import type { ClientDetail } from "@/server/repositories/clients";

type F = ClientInput;

const CURRENCY_LABELS: Readonly<Record<string, string>> = {
  USD: "USD · US dollar", CAD: "CAD · Canadian dollar", EUR: "EUR · Euro", GBP: "GBP · British pound", AUD: "AUD · Australian dollar", MXN: "MXN · Mexican peso",
  NZD: "NZD · New Zealand dollar", SGD: "SGD · Singapore dollar", INR: "INR · Indian rupee", IDR: "IDR · Indonesian rupiah", MYR: "MYR · Malaysian ringgit",
  MAD: "MAD · Moroccan dirham", NGN: "NGN · Nigerian naira", PKR: "PKR · Pakistani rupee", PHP: "PHP · Philippine peso", THB: "THB · Thai baht", TRY: "TRY · Turkish lira", XOF: "XOF · CFA franc",
};
export const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({ value: c, label: CURRENCY_LABELS[c] ?? c }));

type CodeCheck = { readonly code: string; readonly available: boolean; readonly suggestion: string | null };
const TAKEN_MESSAGE = (code: string) => `Client code ${code} is already used`;

function InformationStep({ isEdit, onCodeChecked }: { readonly isEdit: boolean; readonly onCodeChecked: (code: string, available: boolean) => void }) {
  const { setValue, getValues, control, setError, clearErrors, getFieldState } = useFormContext<F>();
  const name = useWatch({ control, name: "name" });
  const code = useWatch({ control, name: "code" });
  const codeTouched = React.useRef(isEdit);
  const [checking, setChecking] = React.useState(false);
  // Suggest only free codes: the suggestion is checked against every client and bumped (APX → APX2) when taken.
  React.useEffect(() => {
    if (codeTouched.current) return;
    const base = suggestClientCode(name ?? "");
    setValue("code", base, { shouldDirty: true });
    if (!base) return;
    let live = true;
    const t = setTimeout(() => {
      apiRequest<CodeCheck>("/api/clients/code-check", { query: { code: base } }).then(({ data }) => {
        if (!live || codeTouched.current) return;
        if (!data.available && data.suggestion) setValue("code", data.suggestion, { shouldDirty: true, shouldValidate: getFieldState("code").invalid });
        onCodeChecked(data.suggestion ?? base, Boolean(data.suggestion));
      }).catch(() => undefined);
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps
  // A code the user typed is checked as they type (debounced), so a clash shows on step 1, not after step 4.
  React.useEffect(() => {
    if (isEdit || !codeTouched.current) return;
    const value = (code ?? "").trim().toUpperCase();
    if (value.length < 2) return;
    let live = true;
    setChecking(true);
    const t = setTimeout(() => {
      apiRequest<CodeCheck>("/api/clients/code-check", { query: { code: value } }).then(({ data }) => {
        if (!live) return;
        onCodeChecked(value, data.available);
        if (!data.available) setError("code", { type: "taken", message: `${TAKEN_MESSAGE(value)}${data.suggestion ? `. Try ${data.suggestion}` : ""}` });
        else if (getFieldState("code").error?.type === "taken") clearErrors("code");
      }).catch(() => undefined).finally(() => { if (live) setChecking(false); });
    }, 350);
    return () => { live = false; clearTimeout(t); setChecking(false); };
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Client details" description="How the client appears across KitStaks and on documents.">
        <FormGrid>
          <TextInput<F> name="name" label="Display name" required maxLength={100} placeholder="e.g. Copperline Coffee" />
          <TextInput<F> name="officialName" label="Official name" required maxLength={200} placeholder="e.g. Copperline Coffee Roasters LLC" info="Legal name printed on bills and BOLs" />
          <FormField<F> name="code" label="Client code" required info={isEdit ? "Codes can't change after creation" : checking ? "Checking that the code is free…" : "Used on SKUs, imports and integrations. Suggested from the display name and checked to be free."} disabled={isEdit}>
            {(c) => <TextField {...c} value={(c.value as string) ?? ""} disabled={isEdit} maxLength={20} className={c.value ? "font-mono uppercase" : undefined} placeholder="e.g. COPPER"
              onChange={(e) => { codeTouched.current = true; c.onChange(e.target.value.toUpperCase()); }} />}
          </FormField>
          <SelectField<F> name="status" label="Status" required options={ACTIVE_STATUSES.map((s) => ({ value: s, label: s }))} info="Inactive clients are hidden from order, PO and billing client selects" />
        </FormGrid>
      </FormSection>
      <FormSection title="Contact" description="Primary contact for notifications and billing questions.">
        <FormGrid columns={3}>
          <TextInput<F> name="contactName" label="Contact name" maxLength={100} />
          <TextInput<F> name="contactEmail" label="Contact email" maxLength={200} placeholder="name@company.com" />
          <TextInput<F> name="phone" label="Phone" maxLength={40} />
        </FormGrid>
      </FormSection>
      {!isEdit ? <p className="text-[12px] text-faint">Code preview: <code className="font-mono text-secondary">{getValues("code") || "—"}</code></p> : null}
    </div>
  );
}

export function SettingsSwitches({ disabled }: { readonly disabled?: boolean }) {
  const { control, setValue } = useFormContext<F>();
  const settings = useWatch({ control, name: "settings" }) as ClientSettingsForm;
  return (
    <div className="flex flex-col gap-4">
      {CLIENT_SETTING_GROUPS.map((g) => {
        const on = g.switches.filter((sw) => settings?.[g.key]?.[sw.key]).length;
        const all = on === g.switches.length;
        return (
          <section key={g.key} className="rounded-lg border border-border bg-surface" aria-labelledby={`grp-${g.key}`}>
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
              <div>
                <h3 id={`grp-${g.key}`} className="text-[13px] font-semibold text-foreground">{g.title}</h3>
                <p className="text-[12px] text-secondary">{g.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-[11px] font-semibold tabular-nums text-neutral">{on} / {g.switches.length} on</span>
                <Button size="sm" variant="ghost" disabled={disabled} onClick={() => g.switches.forEach((sw) => setValue(`settings.${g.key}.${sw.key}` as never, !all as never, { shouldDirty: true }))}>{all ? "Turn all off" : "Turn all on"}</Button>
              </div>
            </header>
            <div className="grid gap-x-6 gap-y-0.5 px-4 py-2 md:grid-cols-2">
              {g.switches.map((sw) => (
                <FormField<F> key={sw.key} name={`settings.${g.key}.${sw.key}` as never} disabled={disabled}>
                  {(c) => (
                    <div className="flex items-center justify-between gap-3 rounded-md px-1 py-1.5 hover:bg-surface-sunken/60">
                      <span className="flex items-center gap-1.5 text-[13px] text-body">
                        <label htmlFor={c.id} className="cursor-pointer">{sw.label}</label>
                        <InfoTip content={sw.tip} label={`About ${sw.label}`} />
                      </span>
                      <Switch id={c.id} checked={Boolean(c.value)} onCheckedChange={(v) => c.onChange(v)} disabled={c.disabled} aria-label={sw.label} />
                    </div>
                  )}
                </FormField>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SettingsStep() {
  const { control } = useFormContext<F>();
  const settings = useWatch({ control, name: "settings" }) as ClientSettingsForm;
  return (
    <div className="flex flex-col gap-4">
      <FormSection title="Currency" description="Bills and VAS prices for this client use this currency.">
        <FormGrid><SelectField<F> name="currency" label="Currency" required options={CURRENCY_OPTIONS} /></FormGrid>
      </FormSection>
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-foreground">Operational settings</h3>
        <span className="text-[12px] text-secondary">{enabledSwitchCount(settings)} of 28 switches on</span>
      </div>
      <SettingsSwitches />
    </div>
  );
}

const digitsOnly = (v: string) => v.replace(/\D/g, "");

/** Logiwa "SSCC18 Barcode Creation": extension digit · GS1 company prefix · serial, with a live check-digit preview. */
function SsccSection() {
  const { control } = useFormContext<F>();
  const sscc = useWatch({ control, name: "sscc" }) as F["sscc"];
  const preview = previewSscc(sscc);
  const prefixLen = sscc?.gs1CompanyPrefix?.length || 7;
  const seg = (label: string, value: string, tone: string) => (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <span className={`rounded px-1.5 py-0.5 font-mono text-[13px] tabular-nums ${tone}`}>{value}</span>
      <span className="text-center text-[11px] leading-tight text-secondary">{label}</span>
    </div>
  );
  return (
    <FormSection title="SSCC-18 barcode creation" description="Pallet and carton LP labels for this client use GS1 SSCC-18 numbers built from these values. Leave all three blank to skip SSCC labels.">
      <div className="flex flex-wrap items-end justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-sunken/40 px-3 py-3" aria-label="SSCC-18 structure">
        {seg("Extension digit", sscc?.extensionDigit || "0", "bg-info-soft text-info")}
        {seg("GS1 company prefix", sscc?.gs1CompanyPrefix || "0".repeat(7), "bg-success-soft text-success")}
        {seg("Serial number", (sscc?.serialNumber || "").padStart(16 - prefixLen, "0"), "bg-warning-soft text-warning")}
        {seg("Check digit", preview ? preview.slice(-1) : "?", "bg-neutral-soft text-neutral")}
      </div>
      <FormGrid columns={3}>
        <TextInput<F> name="sscc.extensionDigit" label="Extension digit" maxLength={1} transform={digitsOnly} placeholder="e.g. 0" info="0–9; often used to tell pallets (e.g. 1) from cartons (e.g. 0)" />
        <TextInput<F> name="sscc.gs1CompanyPrefix" label="GS1 company prefix" maxLength={10} transform={digitsOnly} placeholder="e.g. 0614141" info="The 7–10 digit prefix GS1 assigned to the client" />
        <TextInput<F> name="sscc.serialNumber" label="Serial number" maxLength={16 - prefixLen} transform={digitsOnly} placeholder="e.g. 1" info={`Starting serial reference; up to ${16 - prefixLen} digits with this prefix, zero-padded`} />
      </FormGrid>
      <p className="text-[12px] text-secondary">
        First SSCC-18: {preview ? <code className="font-mono text-[13px] text-foreground">({"00"}) {preview}</code> : <span className="text-faint">complete all three values to preview</span>}
      </p>
    </FormSection>
  );
}

function OthersStep({ form }: { readonly form: UseFormReturn<F> }) {
  const values = useWatch({ control: form.control, name: "customFields" }) as CustomFieldValues | undefined;
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Tax" description="Prices come from the client's 3PL billing forms (Settings › 3PL Billing).">
        <FormGrid>
          <TextInput<F> name="taxId" label="Tax ID" maxLength={40} placeholder="e.g. 84-2317790" info="EIN / VAT number printed on bills" />
        </FormGrid>
      </FormSection>
      <SsccSection />
      <CustomFieldsSection entityType="client" values={values ?? {}} onChange={(v) => form.setValue("customFields", v as F["customFields"], { shouldDirty: true })} />
      <FormSection title="Note" description="Saved to the client's notes with your name and the time.">
        <FormField<F> name="note">
          {(c) => <Textarea {...c} value={(c.value as string | null) ?? ""} maxLength={1000} rows={3} placeholder="e.g. Peak season Oct–Dec; ship-by cutoff 2 pm CT" />}
        </FormField>
      </FormSection>
    </div>
  );
}

export function detailToClientForm(d: ClientDetail): F {
  return {
    name: d.name, code: d.code, officialName: d.officialName ?? d.name, status: d.status, contactName: d.contactName, contactEmail: d.contactEmail, phone: d.phone,
    currency: d.currency as F["currency"], settings: d.settings, taxId: d.taxId ?? "", billingPlan: d.billingPlan as F["billingPlan"], customFields: (d.customFields ?? {}) as F["customFields"], sscc: d.sscc ?? EMPTY_SSCC, note: "",
    addresses: d.addresses.map((a) => ({ id: a.id, name: a.name || a.usageType, usageType: a.usageType, firstName: a.firstName ?? "", lastName: a.lastName ?? "", companyName: a.companyName ?? "", line1: a.line1, line2: a.line2 ?? "", city: a.city, state: a.state ?? "", postalCode: a.postalCode, country: a.country, phone: a.phone ?? "", email: a.email ?? "", isDefault: a.isDefault, isActive: a.isActive })),
  };
}

function Body({ initial, detail, onDone, onCancel, onDirtyChange, startStep }: { readonly initial: F; readonly detail: ClientDetail | null; readonly onDone: (id: string) => void; readonly onCancel: () => void; readonly onDirtyChange: (d: boolean) => void; readonly startStep?: string }) {
  const formRef = React.useRef<UseFormReturn<F> | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const editId = detail?.id ?? null;
  // Version of the record the form was opened on (optimistic concurrency), fixed for this mount.
  const [version] = React.useState(detail?.version);
  const goToRef = React.useRef<((key: string) => void) | null>(null);
  const [taken, setTaken] = React.useState<ReadonlySet<string>>(() => new Set());
  const onCodeChecked = React.useCallback((code: string, available: boolean) => {
    setTaken((prev) => {
      const key = code.trim().toUpperCase();
      if (available === !prev.has(key)) return prev;
      const next = new Set(prev);
      if (available) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const steps = React.useMemo<readonly WizardStep<F>[]>(() => [
    { key: "information", label: "Information", icon: Building2, schema: clientInfoSchema,
      canProceed: (v) => (taken.has((v.code ?? "").trim().toUpperCase()) ? TAKEN_MESSAGE((v.code ?? "").trim().toUpperCase()) : true),
      render: ({ form, goTo }) => { formRef.current = form; goToRef.current = goTo; return <InformationStep isEdit={Boolean(editId)} onCodeChecked={onCodeChecked} />; } },
    { key: "settings", label: "Settings", icon: SlidersHorizontal, schema: clientSettingsStepSchema, render: ({ form }) => { formRef.current = form; return <SettingsStep />; } },
    { key: "addresses", label: "Addresses", icon: MapPin, schema: clientAddressesStepSchema, isOptional: true, render: ({ form }) => { formRef.current = form; return <AddressesField description="Shipping, billing and return addresses. The default of each type is pre-filled on documents." />; } },
    { key: "others", label: "Others", icon: FileText, schema: clientOthersSchema, render: ({ form }) => { formRef.current = form; return <OthersStep form={form} />; } },
  ], [editId, taken, onCodeChecked]);
  void startStep;
  const submit = async (values: F) => {
    try {
      const { data } = await apiRequest<{ id: string; name: string }>(editId ? `/api/clients/${editId}` : "/api/clients", { method: editId ? "PATCH" : "POST", body: { ...values, version } });
      toast.success("Success", editId ? `Client ${data.name} updated.` : `Client ${data.name} has been created successfully.`);
      onDone(data.id ?? editId ?? "");
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      const codeError = isApiError(error) ? error.fieldErrors?.code?.[0] : undefined;
      if (codeError && formRef.current) {
        // Jump back to the step that owns the field, flag it and focus it (not just a toast on step 4).
        const value = String(formRef.current.getValues("code") ?? "").toUpperCase();
        onCodeChecked(value, false);
        const form = formRef.current;
        goToRef.current?.("information");
        setTimeout(() => { form.setError("code", { type: "taken", message: TAKEN_MESSAGE(value) }, { shouldFocus: true }); }, 50);
      } else if (formRef.current) applyServerFieldErrors(formRef.current, error);
      toast.error("Couldn't save the client", isApiError(error) ? error.message : "Something went wrong");
      throw error;
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {conflict ? <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Someone else saved this client. Reload to see their changes.</Callout> : null}
      <Wizard<F> steps={steps} variant="drawer" mode={editId ? "free" : "linear"} defaultValues={initial} draftScope={false} guardUnsaved={false} onDirtyChange={onDirtyChange} submitLabel={editId ? "Save" : "Create client"} onCancel={onCancel} onComplete={submit} />
    </div>
  );
}

export function ClientWizardDrawer({ open, onOpenChange, editId, onSaved }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly editId: string | null; readonly onSaved: (id: string) => void }) {
  const [dirty, setDirty] = React.useState(false);
  const detail = useApiQuery<ClientDetail>(["client", editId ?? ""], open && editId ? `/api/clients/${editId}` : null, { staleTime: 0 });
  const close = () => { setDirty(false); onOpenChange(false); };
  const snap = useFrozenWhileDirty({ key: `${editId ?? "new"}-${detail.dataUpdatedAt}`, data: detail.data?.data }, dirty);
  const initial = editId ? (snap.data ? detailToClientForm(snap.data) : null) : CLIENT_DEFAULTS;
  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())} dirty={dirty} width={60} bodyClassName="pb-0"
      title={editId ? `Edit client ${detail.data?.data.name ?? ""}`.trim() : "Create client"}
      description={editId ? "Every step is editable; Save applies all of them." : "Information, settings, addresses, then tax and custom fields."}>
      {editId && detail.isError ? (
        <EmptyState title="Couldn't load this client" description={detail.error.message} action={<Button onClick={() => void detail.refetch()}>Retry</Button>} />
      ) : !initial ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : (
        <Body key={snap.key} initial={initial} detail={editId ? snap.data ?? null : null} onDirtyChange={setDirty} onCancel={close}
          onDone={(id) => { setDirty(false); onSaved(id); onOpenChange(false); }} />
      )}
    </Drawer>
  );
}
