"use client";

/** App settings panel (gear): fields come from the catalog; PATCH /api/apps/[key] `{ settings }`. */
import * as React from "react";
import { useFormState, useWatch, type FieldValues } from "react-hook-form";
import { CheckCircle2, Copy, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fieldApplies } from "@/lib/grid-defs/admin/apps";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors } from "@/lib/query-client";
import { appSettingsSchema, type AppSettingField } from "@/lib/grid-defs/admin/apps";
import { Drawer } from "@/components/ui/drawer";
import { Form, FormField, SubmitBar, useZodForm } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import type { AppRow } from "@/server/repositories/apps";
import { NumberField, SelectField, TextInput, YesNoField } from "../form-controls";
import { AppIcon } from "./app-icon";

function Field({ f, secretHint }: { readonly f: AppSettingField; readonly secretHint?: string }) {
  const common = { name: f.key as never, label: f.label, required: f.required, info: f.help };
  if (f.type === "secret") {
    return (
      <FormField<FieldValues> {...common} required={f.required && !secretHint}>
        {(c) => <TextField id={c.id} name={c.name} type="password" autoComplete="new-password" ref={c.ref as React.Ref<HTMLInputElement>} value={(c.value as string | null) ?? ""} onChange={(e) => c.onChange(e.target.value)} onBlur={c.onBlur} invalid={c.invalid} aria-invalid={c["aria-invalid"]} aria-describedby={c["aria-describedby"]}
          placeholder={secretHint ? `Saved (••••${secretHint}). Leave blank to keep it` : "Paste the secret"} />}
      </FormField>
    );
  }
  if (f.type === "number") return <NumberField<FieldValues> {...common} min={f.min} max={f.max} suffix={f.suffix} />;
  if (f.type === "boolean") return <YesNoField<FieldValues> {...common} />;
  if (f.type === "enum") return <SelectField<FieldValues> {...common} options={(f.options ?? []).map((o) => ({ value: o, label: f.suffix ? `${o} ${f.suffix}` : o }))} />;
  if (f.type === "textarea") {
    return (
      <FormField<FieldValues> {...common}>
        {(c) => <Textarea id={c.id} name={c.name} ref={c.ref as React.Ref<HTMLTextAreaElement>} rows={6} value={(c.value as string | null) ?? ""} onChange={(e) => c.onChange(e.target.value)} onBlur={c.onBlur} invalid={c.invalid} aria-invalid={c["aria-invalid"]} aria-describedby={c["aria-describedby"]} className="font-mono text-[12px]" placeholder="-----BEGIN CERTIFICATE-----" />}
      </FormField>
    );
  }
  if (f.type === "color") {
    return (
      <FormField<FieldValues> {...common}>
        {(c) => (
          <div className="flex items-center gap-2">
            <input type="color" aria-label={`${f.label} picker`} value={(c.value as string | null) ?? "#4F46E5"} onChange={(e) => c.onChange(e.target.value.toUpperCase())} className="h-8 w-10 cursor-pointer rounded border border-border bg-surface" />
            <TextField id={c.id} name={c.name} ref={c.ref as React.Ref<HTMLInputElement>} value={(c.value as string | null) ?? ""} onChange={(e) => c.onChange(e.target.value)} onBlur={c.onBlur} invalid={c.invalid} aria-invalid={c["aria-invalid"]} aria-describedby={c["aria-describedby"]} maxLength={7} className="w-28 font-mono" />
          </div>
        )}
      </FormField>
    );
  }
  return <TextInput<FieldValues> {...common} maxLength={300} placeholder={f.placeholder} />;
}

/** Fields whose `showWhen` matches the live form values (SSO: OIDC vs SAML fields). */
function VisibleFields({ fields, control, hints }: { readonly fields: readonly AppSettingField[]; readonly control: ReturnType<typeof useZodForm>["control"]; readonly hints: Readonly<Record<string, string>> }) {
  const values = (useWatch({ control }) ?? {}) as Record<string, unknown>;
  return <>{fields.filter((f) => fieldApplies(f, values)).map((f) => <Field key={f.key} f={f} secretHint={hints[f.key]} />)}</>;
}

function CopyRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-40 shrink-0 text-secondary">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-surface px-1.5 py-0.5 font-mono text-[11.5px] text-body" title={value}>{value}</code>
      <button type="button" aria-label={`Copy ${label}`} className="text-secondary hover:text-primary" onClick={() => { void navigator.clipboard?.writeText(value); toast.success("Copied", label); }}><Copy className="h-3.5 w-3.5" aria-hidden /></button>
    </div>
  );
}

interface SsoTest { readonly ok: boolean; readonly checks: readonly { readonly label: string; readonly ok: boolean; readonly detail: string }[] }

/** SSO: what to paste into the identity provider, and a live connection test of the saved settings. */
function SsoServicePanel({ control }: { readonly control: ReturnType<typeof useZodForm>["control"] }) {
  const protocol = useWatch({ control, name: "protocol" as never }) as unknown as string | undefined;
  // Drawer content only renders on the client (after the gear is clicked), so window is available.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const [test, setTest] = React.useState<SsoTest | null>(null);
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await apiRequest<SsoTest>("/api/apps/sso/test", { method: "POST", body: {} });
      setTest(r.data);
    } catch (e) {
      setTest({ ok: false, checks: [{ label: "Connection test", ok: false, detail: isApiError(e) ? e.message : "Failed" }] });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-3" aria-label="Service provider details">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-secondary">In your identity provider</p>
      {protocol === "SAML 2.0" ? (
        <>
          <CopyRow label="SP entity ID / metadata" value={`${origin}/api/auth/sso/metadata`} />
          <CopyRow label="ACS URL" value={`${origin}/api/auth/sso/acs`} />
          <p className="text-[11.5px] text-secondary">KitStak validates the IdP certificate and publishes SP metadata. The sign-in button uses OpenID Connect: switch Protocol to OpenID Connect to turn on &quot;Sign in with SSO&quot;.</p>
        </>
      ) : (
        <>
          <CopyRow label="Sign-in redirect URI" value={`${origin}/api/auth/sso/callback`} />
          <CopyRow label="Initiate login URI" value={`${origin}/api/auth/sso/start`} />
          <p className="text-[11.5px] text-secondary">Create a Web app (authorization code, PKCE) with scopes openid, email, profile. Users sign in only when their email matches an active KitStak user.</p>
        </>
      )}
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={() => void run()} disabled={busy}>{busy ? "Testing…" : "Test saved settings"}</Button>
        {test ? <span className={`text-[12px] font-semibold ${test.ok ? "text-success" : "text-danger"}`}>{test.ok ? "Connection OK" : "Needs attention"}</span> : null}
      </div>
      {test ? (
        <ul className="flex flex-col gap-1" aria-label="Connection test results">
          {test.checks.map((c) => (
            <li key={c.label} className="flex items-start gap-1.5 text-[12px]">
              {c.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />}
              <span className="text-body">{c.label}</span><span className="min-w-0 truncate text-secondary" title={c.detail}>· {c.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function DirtyReport({ control, onDirty }: { readonly control: ReturnType<typeof useZodForm>["control"]; readonly onDirty: (d: boolean) => void }) {
  const { isDirty } = useFormState({ control });
  React.useEffect(() => onDirty(isDirty), [isDirty, onDirty]);
  return null;
}

function SettingsForm({ app, onDone, onCancel, onDirty }: { readonly app: AppRow; readonly onDone: () => void; readonly onCancel: () => void; readonly onDirty: (d: boolean) => void }) {
  const qc = useQueryClient();
  const def = app.def;
  const schema = React.useMemo(() => appSettingsSchema(def!, { savedSecrets: new Set(Object.keys(app.secretHints ?? {})) }), [def, app.secretHints]);
  const form = useZodForm(schema, app.settings as never);
  const submit = async (values: unknown) => {
    try {
      await apiRequest(`/api/apps/${app.key}`, { method: "PATCH", body: { settings: values } });
      await Promise.all([qc.invalidateQueries({ queryKey: ["apps"] }), qc.invalidateQueries({ queryKey: ["me"] })]);
      toast.success("Settings saved", `${app.name} uses the new settings now.`);
      form.reset(values as never);
      onDone();
    } catch (error) {
      applyServerFieldErrors(form, error);
      toast.error("Couldn't save settings", isApiError(error) ? error.message : "Something went wrong");
    }
  };
  return (
    <Form form={form} onSubmit={submit} className="flex flex-col gap-4">
      <DirtyReport control={form.control} onDirty={onDirty} />
      <div className="flex items-center gap-3 rounded-lg bg-surface-sunken px-3 py-3">
        <AppIcon def={def} />
        <p className="text-[12.5px] text-secondary">{def?.unlocks.join(" · ")}</p>
      </div>
      <VisibleFields fields={def?.settings ?? []} control={form.control} hints={app.secretHints ?? {}} />
      {app.key === "sso" ? <SsoServicePanel control={form.control} /> : null}
      <SubmitBar submitLabel="Save settings" onCancel={onCancel} requireDirty sticky />
    </Form>
  );
}

export function AppSettingsDrawer({ app, onClose }: { readonly app: AppRow | null; readonly onClose: () => void }) {
  const [dirty, setDirty] = React.useState(false);
  const close = () => { setDirty(false); onClose(); };
  return (
    <Drawer open={app !== null} onOpenChange={(o) => !o && close()} dirty={dirty} width={35} bodyClassName="pb-0" title={`${app?.name ?? "App"} settings`} description={app?.isActive ? "Active for every user with access." : "Settings apply once the app is activated."}>
      {app && app.def && app.def.settings.length > 0 ? <SettingsForm key={app.key} app={app} onDone={close} onCancel={close} onDirty={setDirty} /> : <p className="text-[13px] text-faint">This app has no settings.</p>}
    </Drawer>
  );
}
