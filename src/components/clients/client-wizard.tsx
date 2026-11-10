"use client";

/**
 * Create / Edit Client drawer (4 steps): 1. Information (display + official name, code,
 * status, contact) · 2. Settings (currency + 28 switches in 4 groups, each with a
 * description tooltip and a group "turn all on/off") · 3. Addresses (multi-address modal,
 * usage type + default) · 4. Others (tax ID, billing plan, custom fields, note).
 */
import * as React from "react";
import { Building2, FileText, MapPin, SlidersHorizontal } from "lucide-react";
import { useFormContext, useWatch, type UseFormReturn } from "react-hook-form";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import { ACTIVE_STATUSES, CLIENT_BILLING_PLANS, CURRENCIES } from "@/lib/enums";
import {
  CLIENT_DEFAULTS, CLIENT_SETTING_GROUPS, clientInfoSchema, clientOthersSchema, clientSettingsStepSchema, enabledSwitchCount, suggestClientCode, type ClientInput, type ClientSettingsForm,
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
const PLAN_LABELS: Readonly<Record<string, string>> = { "per-order": "Per order", "per-unit": "Per unit", monthly: "Monthly flat" };

function InformationStep({ isEdit }: { readonly isEdit: boolean }) {
  const { setValue, getValues, control } = useFormContext<F>();
  const name = useWatch({ control, name: "name" });
  const codeTouched = React.useRef(isEdit);
  React.useEffect(() => {
    if (codeTouched.current) return;
    setValue("code", suggestClientCode(name ?? ""), { shouldDirty: true });
  }, [name, setValue]);
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Information" description="How the client appears across KitStaks and on documents.">
        <FormGrid>
          <TextInput<F> name="name" label="Display name" required maxLength={100} placeholder="e.g. Copperline Coffee" />
          <TextInput<F> name="officialName" label="Official name" required maxLength={200} placeholder="e.g. Copperline Coffee Roasters LLC" info="Legal name printed on bills and BOLs" />
          <FormField<F> name="code" label="Client code" required info={isEdit ? "Codes can't change after creation" : "Used on SKUs, imports and integrations. Suggested from the display name."} disabled={isEdit}>
            {(c) => <TextField {...c} value={(c.value as string) ?? ""} disabled={isEdit} maxLength={20} className="font-mono uppercase" placeholder="COPPER"
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

function OthersStep({ form }: { readonly form: UseFormReturn<F> }) {
  const values = useWatch({ control: form.control, name: "customFields" }) as CustomFieldValues | undefined;
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Tax and billing">
        <FormGrid>
          <TextInput<F> name="taxId" label="Tax ID" maxLength={40} placeholder="e.g. 84-2317790" info="EIN / VAT number printed on bills" />
          <SelectField<F> name="billingPlan" label="Billing plan" options={CLIENT_BILLING_PLANS.map((p) => ({ value: p, label: PLAN_LABELS[p] ?? p }))} info="Summary label only; prices come from the client's 3PL billing forms" />
        </FormGrid>
      </FormSection>
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
    currency: d.currency as F["currency"], settings: d.settings, taxId: d.taxId ?? "", billingPlan: d.billingPlan as F["billingPlan"], customFields: d.customFields as F["customFields"], note: "",
    addresses: d.addresses.map((a) => ({ id: a.id, name: a.name || a.usageType, usageType: a.usageType, companyName: a.companyName ?? "", line1: a.line1, line2: a.line2 ?? "", city: a.city, state: a.state ?? "", postalCode: a.postalCode, country: a.country, phone: a.phone ?? "", email: a.email ?? "", isDefault: a.isDefault, isActive: a.isActive })),
  };
}

function Body({ initial, detail, onDone, onCancel, onDirtyChange, startStep }: { readonly initial: F; readonly detail: ClientDetail | null; readonly onDone: (id: string) => void; readonly onCancel: () => void; readonly onDirtyChange: (d: boolean) => void; readonly startStep?: string }) {
  const formRef = React.useRef<UseFormReturn<F> | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const editId = detail?.id ?? null;
  const steps = React.useMemo<readonly WizardStep<F>[]>(() => [
    { key: "information", label: "Information", icon: Building2, schema: clientInfoSchema, render: ({ form }) => { formRef.current = form; return <InformationStep isEdit={Boolean(editId)} />; } },
    { key: "settings", label: "Settings", icon: SlidersHorizontal, schema: clientSettingsStepSchema, render: ({ form }) => { formRef.current = form; return <SettingsStep />; } },
    { key: "addresses", label: "Addresses", icon: MapPin, schema: clientAddressesStepSchema, isOptional: true, render: ({ form }) => { formRef.current = form; return <AddressesField description="Shipping, billing and return addresses. The default of each type is pre-filled on documents." />; } },
    { key: "others", label: "Others", icon: FileText, schema: clientOthersSchema, render: ({ form }) => { formRef.current = form; return <OthersStep form={form} />; } },
  ], [editId]);
  void startStep;
  const submit = async (values: F) => {
    try {
      const { data } = await apiRequest<{ id: string; name: string }>(editId ? `/api/clients/${editId}` : "/api/clients", { method: editId ? "PATCH" : "POST", body: { ...values, version: detail?.version } });
      toast.success("Success", editId ? `Client ${data.name} updated.` : `Client ${data.name} has been created successfully.`);
      onDone(data.id ?? editId ?? "");
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      if (formRef.current) applyServerFieldErrors(formRef.current, error);
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
  const initial = editId ? (detail.data ? detailToClientForm(detail.data.data) : null) : CLIENT_DEFAULTS;
  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())} dirty={dirty} width={60}
      title={editId ? `Edit client ${detail.data?.data.name ?? ""}`.trim() : "Create client"}
      description={editId ? "Every step is editable; Save applies all of them." : "Information, settings, addresses, then tax and custom fields."}>
      {editId && detail.isError ? (
        <EmptyState title="Couldn't load this client" description={detail.error.message} action={<Button onClick={() => void detail.refetch()}>Retry</Button>} />
      ) : !initial ? (
        <div className="flex flex-col gap-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : (
        <Body key={`${editId ?? "new"}-${detail.dataUpdatedAt}`} initial={initial} detail={editId ? detail.data?.data ?? null : null} onDirtyChange={setDirty} onCancel={close}
          onDone={(id) => { setDirty(false); onSaved(id); onOpenChange(false); }} />
      )}
    </Drawer>
  );
}
