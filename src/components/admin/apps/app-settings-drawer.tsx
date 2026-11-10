"use client";

/** App settings panel (gear): fields come from the catalog; PATCH /api/apps/[key] `{ settings }`. */
import * as React from "react";
import { useFormState, type FieldValues } from "react-hook-form";
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

function Field({ f }: { readonly f: AppSettingField }) {
  const common = { name: f.key as never, label: f.label, required: f.required, info: f.help };
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
  return <TextInput<FieldValues> {...common} maxLength={300} />;
}

function DirtyReport({ control, onDirty }: { readonly control: ReturnType<typeof useZodForm>["control"]; readonly onDirty: (d: boolean) => void }) {
  const { isDirty } = useFormState({ control });
  React.useEffect(() => onDirty(isDirty), [isDirty, onDirty]);
  return null;
}

function SettingsForm({ app, onDone, onCancel, onDirty }: { readonly app: AppRow; readonly onDone: () => void; readonly onCancel: () => void; readonly onDirty: (d: boolean) => void }) {
  const qc = useQueryClient();
  const def = app.def;
  const schema = React.useMemo(() => appSettingsSchema(def!), [def]);
  const form = useZodForm(schema, app.settings as never);
  const submit = async (values: unknown) => {
    try {
      await apiRequest(`/api/apps/${app.key}`, { method: "PATCH", body: { settings: values } });
      await qc.invalidateQueries({ queryKey: ["apps"] });
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
      {def?.settings.map((f) => <Field key={f.key} f={f} />)}
      <SubmitBar submitLabel="Save settings" onCancel={onCancel} requireDirty sticky />
    </Form>
  );
}

export function AppSettingsDrawer({ app, onClose }: { readonly app: AppRow | null; readonly onClose: () => void }) {
  const [dirty, setDirty] = React.useState(false);
  const close = () => { setDirty(false); onClose(); };
  return (
    <Drawer open={app !== null} onOpenChange={(o) => !o && close()} dirty={dirty} width={35} title={`${app?.name ?? "App"} settings`} description={app?.isActive ? "Active for every user with access." : "Settings apply once the app is activated."}>
      {app && app.def && app.def.settings.length > 0 ? <SettingsForm key={app.key} app={app} onDone={close} onCancel={close} onDirty={setDirty} /> : <p className="text-[13px] text-faint">This app has no settings.</p>}
    </Drawer>
  );
}
