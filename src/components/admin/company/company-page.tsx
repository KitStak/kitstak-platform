"use client";

/**
 * Company Settings (`/settings/company?section=info|defaults|security|email`): company information
 * with logo upload (JPG/PNG < 2 MB, shown in the shell and on printouts), account defaults
 * (currency, units, date format) and security (password policy, expiry, lockout).
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, History, ImageUp, Lock, Mail, SlidersHorizontal, Trash2 } from "lucide-react";
import { useWatch } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import { CURRENCIES, DIMENSION_UNITS, WEIGHT_UNITS } from "@/lib/enums";
import { createFormatter } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  COMPANY_BRANDING_QUERY_KEY, COMPANY_DATE_FORMATS, companyDefaultsSchema, companyInfoSchema, companySecuritySchema, IDLE_MAX_MINUTES, IDLE_MIN_MINUTES, IDLE_WARNING_SECONDS, LOGO_MAX_BYTES, policySummary,
  type CompanyDefaultsValues, type CompanyInfoValues, type CompanySecurityValues,
} from "@/lib/grid-defs/admin/company";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Form, FormGrid, FormSection, SubmitBar, useZodForm } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { VerticalNav } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import type { CompanySettings } from "@/server/repositories/company";
import { EntityChangeLogDrawer, NO_PERMISSION, usePagePerms } from "../admin-shared";
import { NumberField, SelectField, TextInput, YesNoField } from "../form-controls";
import { useShell } from "@/components/layout/shell-context";
import { MailSection } from "./mail-section";

type Section = "info" | "defaults" | "security" | "email";
const SECTIONS: readonly { key: Section; label: string; icon: React.ComponentType<{ className?: string }>; title: string; description: string }[] = [
  { key: "info", label: "Company information", icon: Building2, title: "Company information", description: "Create a profile for your company. The logo appears in the header and on every printout." },
  { key: "defaults", label: "Account defaults", icon: SlidersHorizontal, title: "Account defaults", description: "Defaults for new clients, products and users." },
  { key: "security", label: "Security", icon: Lock, title: "Security", description: "Password rules, account lockout and idle sign-out for every user." },
  { key: "email", label: "Email delivery", icon: Mail, title: "Email delivery", description: "The mail server KitStaks uses for welcome invites and password reset emails." },
];

const QUERY_KEY = ["company"];

function useSave<T>(section: Section, onSaved: (c: CompanySettings) => void) {
  const [conflict, setConflict] = React.useState(false);
  const save = async (form: { setError: never; getValues: () => unknown } | unknown, values: T, version: number) => {
    try {
      const { data } = await apiRequest<CompanySettings>(`/api/company?section=${section}`, { method: "PATCH", body: { ...values, version } });
      toast.success("Company settings saved", SECTIONS.find((s) => s.key === section)?.label ?? "");
      onSaved(data);
      return data;
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      applyServerFieldErrors(form as never, error);
      toast.error("Couldn't save", isApiError(error) ? error.message : "Something went wrong");
      return null;
    }
  };
  return { save, conflict };
}

function ConflictCallout({ show }: { readonly show: boolean }) {
  return show ? <Callout variant="attention" title="These settings changed since you opened them" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Someone else saved company settings. Reload to see their changes.</Callout> : null;
}

function LogoBlock({ company, canEdit, onChanged }: { readonly company: CompanySettings; readonly canEdit: boolean; readonly onChanged: (c: CompanySettings) => void }) {
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const qc = useQueryClient();
  const refreshShell = () => void qc.invalidateQueries({ queryKey: COMPANY_BRANDING_QUERY_KEY });
  const upload = async (file: File) => {
    setError(null);
    if (!["image/png", "image/jpeg"].includes(file.type)) { setError("Only JPG and PNG images are accepted."); return; }
    if (file.size >= LOGO_MAX_BYTES) { setError("Use an image smaller than 2 MB."); return; }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const { data } = await apiRequest<CompanySettings>("/api/company/logo", { method: "POST", body });
      toast.success("Logo updated", "It now shows in the header and on printouts.");
      onChanged(data);
      refreshShell();
    } catch (e) {
      setError(isApiError(e) ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-body">Company logo</span>
      <div className="flex items-center gap-4">
        <div className={cn("flex h-20 w-40 items-center justify-center overflow-hidden rounded-lg border bg-surface-sunken", error ? "border-danger" : "border-dashed border-border-strong")}>
          {company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logoUrl} alt={`${company.displayName} logo`} className="max-h-16 max-w-36 object-contain" />
          ) : <span className="text-2xs text-faint">No logo yet</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" aria-label="Choose a logo image" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          <div className="flex gap-2">
            <DisabledReason reason={canEdit ? null : NO_PERMISSION}><Button size="sm" variant="secondary" disabled={!canEdit || busy} onClick={() => input.current?.click()}><ImageUp className="h-3.5 w-3.5" aria-hidden />{busy ? "Uploading…" : company.logoUrl ? "Replace" : "Add file"}</Button></DisabledReason>
            {company.logoUrl ? <DisabledReason reason={canEdit ? null : NO_PERMISSION}><Button size="sm" variant="ghost" disabled={!canEdit || busy} onClick={() => setConfirm(true)}><Trash2 className="h-3.5 w-3.5" aria-hidden />Remove</Button></DisabledReason> : null}
          </div>
          <span className={cn("text-2xs", error ? "text-danger" : "text-faint")} role={error ? "alert" : undefined}>{error ?? "JPG, JPEG or PNG, smaller than 2 MB."}</span>
        </div>
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} variant="danger" title="Remove the company logo?" description="The header falls back to the KitStak logo and printouts to your company name." confirmLabel="Yes, remove" cancelLabel="No"
        onConfirm={async () => {
          try { const { data } = await apiRequest<CompanySettings>("/api/company/logo", { method: "DELETE" }); onChanged(data); refreshShell(); toast.success("Logo removed", "The header shows the KitStak logo again and printouts show your company name."); }
          catch (e) { toast.error("Couldn't remove the logo", isApiError(e) ? e.message : "Something went wrong"); }
          setConfirm(false);
        }} />
    </div>
  );
}

function InfoSection({ company, canEdit, onSaved }: { readonly company: CompanySettings; readonly canEdit: boolean; readonly onSaved: (c: CompanySettings) => void }) {
  const initial: CompanyInfoValues = { displayName: company.displayName, fullName: company.fullName };
  const form = useZodForm(companyInfoSchema, initial);
  const { save, conflict } = useSave<CompanyInfoValues>("info", onSaved);
  return (
    <Form form={form} onSubmit={async (v) => { const r = await save(form, v, company.version); if (r) form.reset({ displayName: r.displayName, fullName: r.fullName }); }} className="flex flex-col gap-5" guardUnsaved>
      <ConflictCallout show={conflict} />
      <FormGrid>
        <TextInput<CompanyInfoValues> name="displayName" label="Company display name" required maxLength={60} disabled={!canEdit} info="Short name used in the header and emails" />
        <TextInput<CompanyInfoValues> name="fullName" label="Company full name" required maxLength={160} disabled={!canEdit} info="Legal name printed on documents" />
      </FormGrid>
      <LogoBlock company={company} canEdit={canEdit} onChanged={onSaved} />
      {canEdit ? <SubmitBar submitLabel="Update company info" cancelLabel="Reset" requireDirty onCancel={() => form.reset(initial)} /> : null}
    </Form>
  );
}

function DefaultsSection({ company, canEdit, onSaved }: { readonly company: CompanySettings; readonly canEdit: boolean; readonly onSaved: (c: CompanySettings) => void }) {
  const initial: CompanyDefaultsValues = { currency: company.defaults.currency as CompanyDefaultsValues["currency"], weightUnit: company.defaults.weightUnit as CompanyDefaultsValues["weightUnit"], dimensionUnit: company.defaults.dimensionUnit as CompanyDefaultsValues["dimensionUnit"], dateFormat: company.defaults.dateFormat };
  const form = useZodForm(companyDefaultsSchema, initial);
  const { save, conflict } = useSave<CompanyDefaultsValues>("defaults", onSaved);
  const w = useWatch({ control: form.control });
  const fmt = createFormatter({ dateFormat: w.dateFormat ?? initial.dateFormat });
  // Today's date, set after mount (a server-rendered "now" would not match the client's).
  const [today, setToday] = React.useState<Date | null>(null);
  React.useEffect(() => { setToday(new Date()); }, []);
  return (
    <Form form={form} onSubmit={async (v) => { const r = await save(form, v, company.version); if (r) form.reset(v); }} className="flex flex-col gap-5" guardUnsaved>
      <ConflictCallout show={conflict} />
      <FormGrid>
        <SelectField<CompanyDefaultsValues> name="currency" label="Currency" required disabled={!canEdit} options={CURRENCIES.map((c) => ({ value: c, label: c }))} info="Default for new billing contracts and product prices" />
        <SelectField<CompanyDefaultsValues> name="dateFormat" label="Date format" required disabled={!canEdit} options={COMPANY_DATE_FORMATS} info="Default for new users; each user can override it in Preferences" />
        <SelectField<CompanyDefaultsValues> name="weightUnit" label="Weight unit" required disabled={!canEdit} options={WEIGHT_UNITS.map((u) => ({ value: u, label: u }))} />
        <SelectField<CompanyDefaultsValues> name="dimensionUnit" label="Dimension unit" required disabled={!canEdit} options={DIMENSION_UNITS.map((u) => ({ value: u, label: u }))} />
      </FormGrid>
      <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3 text-sm">
        <p className="text-2xs font-bold text-faint">Example</p>
        <p className="mt-1 text-foreground">A new product weighs <b>2.5 {w.weightUnit}</b>, measures <b>12 × 8 × 4 {w.dimensionUnit}</b>, sells for <b>{fmt.money(24.99, w.currency)}</b> and was created <b>{today ? fmt.date(today) : "today"}</b>.</p>
      </div>
      {canEdit ? <SubmitBar submitLabel="Save defaults" cancelLabel="Reset" requireDirty onCancel={() => form.reset(initial)} /> : null}
    </Form>
  );
}

function SecuritySection({ company, canEdit, onSaved }: { readonly company: CompanySettings; readonly canEdit: boolean; readonly onSaved: (c: CompanySettings) => void }) {
  const p = company.passwordPolicy;
  const initial: CompanySecurityValues = { minLength: p.minLength, requireUpper: p.requireUpper, requireNumber: p.requireNumber, requireSymbol: p.requireSymbol, expires: Boolean(p.maxAgeDays), maxAgeDays: p.maxAgeDays ?? 90, lockoutThreshold: p.lockoutThreshold, lockoutMinutes: p.lockoutMinutes, idleTimeout: company.sessionIdleMinutes !== null, idleMinutes: company.sessionIdleMinutes ?? 30 };
  const form = useZodForm(companySecuritySchema, initial);
  const { save, conflict } = useSave<CompanySecurityValues>("security", onSaved);
  const w = useWatch({ control: form.control });
  return (
    <Form form={form} onSubmit={async (v) => { const r = await save(form, v, company.version); if (r) form.reset(v); }} className="flex flex-col gap-5" guardUnsaved>
      <ConflictCallout show={conflict} />
      <FormSection title="Password policy" description={`New passwords need ${policySummary({ minLength: Number(w.minLength) || 8, requireUpper: Boolean(w.requireUpper), requireNumber: Boolean(w.requireNumber), requireSymbol: Boolean(w.requireSymbol) })}. Existing passwords keep working until they're changed.`}>
        <FormGrid>
          <NumberField<CompanySecurityValues> name="minLength" label="Minimum length" required min={8} max={64} disabled={!canEdit} suffix="characters" />
          <YesNoField<CompanySecurityValues> name="requireUpper" label="Require upper and lower case" disabled={!canEdit} />
          <YesNoField<CompanySecurityValues> name="requireNumber" label="Require a number" disabled={!canEdit} />
          <YesNoField<CompanySecurityValues> name="requireSymbol" label="Require a symbol" disabled={!canEdit} />
          <YesNoField<CompanySecurityValues> name="expires" label="Passwords expire" disabled={!canEdit} info="Users must choose a new password after this many days" />
          {w.expires ? <NumberField<CompanySecurityValues> name="maxAgeDays" label="Expire after" required min={1} max={3650} disabled={!canEdit} suffix="days" /> : null}
        </FormGrid>
      </FormSection>
      <FormSection title="Account lockout" description={`After ${w.lockoutThreshold ?? "—"} failed sign-ins in a row the account is locked for ${w.lockoutMinutes ?? "—"} minutes.`}>
        <FormGrid>
          <NumberField<CompanySecurityValues> name="lockoutThreshold" label="Lock after" required min={3} max={50} disabled={!canEdit} suffix="failed attempts" />
          <NumberField<CompanySecurityValues> name="lockoutMinutes" label="Lock for" required min={1} max={1440} disabled={!canEdit} suffix="minutes" />
        </FormGrid>
      </FormSection>
      <FormSection title="Idle sign-out" description={w.idleTimeout ? `Web users are signed out after ${w.idleMinutes ?? "—"} minutes without activity in any tab, with a ${IDLE_WARNING_SECONDS}-second warning first.` : "Web sessions stay signed in until they expire or the user signs out."}>
        <FormGrid>
          <YesNoField<CompanySecurityValues> name="idleTimeout" label="Sign out idle users" disabled={!canEdit} info="Activity in any open KitStaks tab keeps the session alive" />
          {w.idleTimeout ? <NumberField<CompanySecurityValues> name="idleMinutes" label="Sign out after" required min={IDLE_MIN_MINUTES} max={IDLE_MAX_MINUTES} disabled={!canEdit} suffix="minutes idle" /> : null}
        </FormGrid>
      </FormSection>
      {canEdit ? <SubmitBar submitLabel="Save security settings" cancelLabel="Reset" requireDirty onCancel={() => form.reset(initial)} /> : null}
    </Form>
  );
}

export function CompanyPage() {
  const perms = usePagePerms("settings.company_settings", ["view", "update"] as const);
  const router = useRouter();
  const params = useSearchParams();
  const section: Section = (["info", "defaults", "security", "email"] as const).find((s) => s === params.get("section")) ?? "info";
  const { user } = useShell();
  const q = useApiQuery<CompanySettings>(QUERY_KEY, "/api/company", { staleTime: 0 });
  const [local, setLocal] = React.useState<CompanySettings | null>(null);
  const [log, setLog] = React.useState(false);
  const company = local && q.data && local.version >= q.data.data.version ? local : (q.data?.data ?? null);
  const meta = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0]!;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader breadcrumbs={[{ label: "Settings" }, { label: "Company Settings" }]} title="Company Settings" helper="Define your company with a display name, full name and logo, plus defaults and security rules."
        actions={<Button variant="secondary" onClick={() => setLog(true)}><History className="h-4 w-4" aria-hidden />Change log</Button>} />
      <div className="grid max-w-[1280px] gap-6 px-6 py-5 md:grid-cols-[220px_minmax(0,1fr)]">
        <section aria-labelledby="company-section-title" className="rounded-xl border border-border bg-surface p-5 shadow-xs">
          <h2 id="company-section-title" className="text-md font-semibold text-foreground">{meta.title}</h2>
          <p className="mt-0.5 text-xs text-secondary">{meta.description}</p>
          <div className="mt-5">
            {section === "email" ? <MailSection canEdit={perms.update} defaultTo={user?.email ?? ""} /> : q.isPending ? <Skeleton className="h-64 w-full" /> : q.isError || !company ? (
              <EmptyState title="Couldn't load company settings" description={q.error?.message} action={<Button onClick={() => void q.refetch()}>Retry</Button>} />
            ) : section === "info" ? <InfoSection key={`i${company.version}`} company={company} canEdit={perms.update} onSaved={setLocal} />
              : section === "defaults" ? <DefaultsSection key={`d${company.version}`} company={company} canEdit={perms.update} onSaved={setLocal} />
              : <SecuritySection key={`s${company.version}`} company={company} canEdit={perms.update} onSaved={setLocal} />}
          </div>
        </section>
        <VerticalNav ariaLabel="Company settings sections" active={section} className="self-start md:sticky md:top-4 md:order-first md:pt-1"
          items={SECTIONS.map((s) => ({ key: s.key, label: s.label, icon: s.icon }))}
          onChange={(key) => router.replace(`/settings/company?section=${key}`, { scroll: false })} />
      </div>
      <EntityChangeLogDrawer open={log} onOpenChange={setLog} path="/api/company/change-log" title="Company settings change log" />
    </div>
  );
}
