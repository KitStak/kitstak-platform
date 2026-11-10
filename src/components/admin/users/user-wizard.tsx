"use client";

/**
 * Add User (4 steps: User info · Roles · Warehouse · Client) and Edit User (same tabs, free
 * navigation, password optional). Every step validates on Next and can go back; a stale edit
 * shows the Reload prompt (409).
 */
import * as React from "react";
import { Building2, KeyRound, ShieldCheck, UserRound, Users2 } from "lucide-react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import {
  CREATABLE_USER_TYPES, USER_FORM_DEFAULTS, userClientsStepSchema, userInfoCreateSchema, userInfoEditSchema,
  userRolesStepSchema, userWarehousesStepSchema, type UserFormValues,
} from "@/lib/grid-defs/admin/users";
import { USER_TYPES } from "@/lib/enums";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField, FormGrid, FormSection } from "@/components/ui/form";
import { RadioCards } from "@/components/ui/radio-cards";
import { Skeleton } from "@/components/ui/skeleton";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { Wizard, type WizardStep } from "@/components/ui/wizard";
import { AccessGrid } from "../access-grid";
import { useAdminOptions, type AdminOptions } from "../admin-shared";
import { SelectField, TextInput, YesNoField } from "../form-controls";
import { PasswordMeter, usePasswordPolicy } from "../password-meter";
import type { UserDetail } from "@/server/repositories/users";

type F = UserFormValues;

function PasswordInput({ name, label, required, info, describedBy }: { readonly name: "password" | "confirmPassword"; readonly label: string; readonly required: boolean; readonly info?: string; readonly describedBy?: string }) {
  return (
    <FormField<F> name={name} label={label} required={required} info={info}>
      {(c) => (
        <TextField
          id={c.id} name={c.name} ref={c.ref as React.Ref<HTMLInputElement>} type="password" autoComplete="new-password"
          value={(c.value as string | null) ?? ""} onChange={(e) => c.onChange(e.target.value)} onBlur={c.onBlur}
          invalid={c.invalid} aria-invalid={c["aria-invalid"]} aria-describedby={[c["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined}
        />
      )}
    </FormField>
  );
}

function InfoStep({ form, isEdit, isOwner }: { readonly form: UseFormReturn<F>; readonly isEdit: boolean; readonly isOwner: boolean }) {
  const policy = usePasswordPolicy();
  const password = useWatch({ control: form.control, name: "password" }) ?? "";
  const typeOptions = (isOwner ? USER_TYPES : CREATABLE_USER_TYPES).map((t) => ({ value: t, label: t }));
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="User information">
        <FormGrid>
          <TextInput<F> name="firstName" label="First name" required maxLength={60} placeholder="e.g. Jordan" />
          <TextInput<F> name="lastName" label="Last name" required maxLength={60} placeholder="e.g. Reyes" />
          <TextInput<F> name="email" label="Email" required maxLength={254} placeholder="name@company.com" transform={(v) => v.trim()} />
          <SelectField<F> name="userType" label="User type" required options={typeOptions} disabled={isOwner} info={isOwner ? "The account owner's type can't change" : "Client users only see their own clients' data"} />
        </FormGrid>
      </FormSection>
      <FormSection title={isEdit ? "Change password" : "Password"} description={isEdit ? "Leave both fields blank to keep the current password. A new password signs the user out everywhere." : undefined}>
        <FormGrid>
          <div>
            <PasswordInput name="password" label={isEdit ? "New password" : "Password"} required={!isEdit} describedBy="user-password-meter" />
            {password || !isEdit ? <PasswordMeter id="user-password-meter" password={password} policy={policy} /> : null}
          </div>
          <PasswordInput name="confirmPassword" label="Confirm password" required={!isEdit} />
        </FormGrid>
      </FormSection>
      <FormSection title="Access">
        <FormGrid>
          {!isEdit ? <YesNoField<F> name="sendWelcomeEmail" label="Send welcome email" info="Emails a link to set their own password" /> : null}
          <YesNoField<F> name="isActive" label="Active" info="Inactive users can't sign in. Deactivating signs them out on their next click." />
        </FormGrid>
      </FormSection>
    </div>
  );
}

function ArrayStep({ name, items, noun, columnLabel, title, description, loading }: { readonly name: "roleIds" | "warehouseIds" | "clientIds"; readonly items: Parameters<typeof AccessGrid>[0]["items"]; readonly noun: string; readonly columnLabel: string; readonly title: string; readonly description: string; readonly loading: boolean }) {
  return (
    <FormSection title={title} description={description}>
      <FormField<F> name={name}>
        {(c) => <AccessGrid items={items} value={(c.value as string[] | null) ?? []} onChange={(ids) => c.onChange(ids)} noun={noun} columnLabel={columnLabel} invalid={c.invalid} describedBy={c["aria-describedby"]} loading={loading} />}
      </FormField>
    </FormSection>
  );
}

function ClientStep({ form, options }: { readonly form: UseFormReturn<F>; readonly options: AdminOptions & { loading: boolean } }) {
  const allClients = useWatch({ control: form.control, name: "allClients" });
  return (
    <div className="flex flex-col gap-4">
      <FormField<F> name="allClients" label="Client access" required>
        {(c) => (
          <RadioCards<"all" | "manual">
            ariaLabel="Client access"
            columns={2}
            value={c.value ? "all" : "manual"}
            onChange={(v) => c.onChange(v === "all")}
            options={[
              { value: "all", title: "All clients", description: "Give access to all existing and future clients.", icon: Building2 },
              { value: "manual", title: "Select manually", description: "List clients and give access to them by selection.", icon: Users2 },
            ]}
          />
        )}
      </FormField>
      {allClients ? null : (
        <ArrayStep name="clientIds" items={options.clients.map((cl) => ({ id: cl.id, label: cl.name, description: cl.code }))} noun="client" columnLabel="Client" title="Clients" description="The user sees orders, inventory and reports of these clients only." loading={options.loading} />
      )}
    </div>
  );
}

export function detailToUserForm(d: UserDetail): F {
  return {
    firstName: d.firstName ?? d.name.split(" ")[0] ?? "", lastName: d.lastName ?? d.name.split(" ").slice(1).join(" "), email: d.email,
    userType: d.userType as F["userType"], password: "", confirmPassword: "", sendWelcomeEmail: false, isActive: d.isActive,
    roleIds: [...d.roleIds], warehouseIds: [...d.warehouseIds], allClients: d.allClients, clientIds: [...d.clientIds],
  };
}

function Body({ initial, detail, onDone, onCancel, onDirtyChange }: { readonly initial: F; readonly detail: UserDetail | null; readonly onDone: () => void; readonly onCancel: () => void; readonly onDirtyChange: (d: boolean) => void }) {
  const options = useAdminOptions();
  const formRef = React.useRef<UseFormReturn<F> | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const editId = detail?.id ?? null;
  const isOwner = detail?.userType === "Owner";
  const roleItems = options.roles.map((r) => ({ id: r.id, label: r.name, description: r.description ?? `${r.category} role`, badge: r.isSystem ? <Badge size="sm" tone="neutral">System</Badge> : null }));
  const warehouseItems = options.warehouses.map((w) => ({ id: w.id, label: w.name, description: w.code }));
  const steps = React.useMemo<readonly WizardStep<F>[]>(() => [
    { key: "info", label: "User info", icon: UserRound, schema: editId ? userInfoEditSchema : userInfoCreateSchema, render: ({ form }) => { formRef.current = form; return <InfoStep form={form} isEdit={Boolean(editId)} isOwner={isOwner} />; } },
    { key: "roles", label: "Roles", icon: ShieldCheck, schema: userRolesStepSchema, render: ({ form }) => { formRef.current = form; return <ArrayStep name="roleIds" items={roleItems} noun="role" columnLabel="Role name" title="Roles" description="Permissions are the union of every assigned role." loading={options.loading} />; } },
    { key: "warehouses", label: "Warehouse", icon: KeyRound, schema: userWarehousesStepSchema, render: ({ form }) => { formRef.current = form; return <ArrayStep name="warehouseIds" items={warehouseItems} noun="warehouse" columnLabel="Warehouse" title="Warehouses" description="Data from other warehouses is hidden in every grid, report and API call." loading={options.loading} />; } },
    { key: "clients", label: "Client", icon: Building2, schema: userClientsStepSchema, render: ({ form }) => { formRef.current = form; return <ClientStep form={form} options={options} />; } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [editId, isOwner, options.loading, options.roles.length, options.warehouses.length, options.clients.length]);

  const submit = async (values: F) => {
    try {
      const body = { ...values, clientIds: values.allClients ? [] : values.clientIds, version: detail?.version };
      if (editId) {
        const { data } = await apiRequest<{ sessionsRevoked: boolean }>(`/api/users/${editId}`, { method: "PATCH", body });
        toast.success("User updated", data.sessionsRevoked ? `${values.firstName} ${values.lastName} was signed out so the new access applies.` : `${values.firstName} ${values.lastName} saved.`);
      } else {
        const { data } = await apiRequest<{ name: string; welcomeSent: boolean }>("/api/users", { method: "POST", body });
        toast.success("User created", data.welcomeSent ? `${data.name} was emailed a link to set their password.` : `${data.name} can sign in now.`);
      }
      onDone();
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      if (formRef.current) applyServerFieldErrors(formRef.current, error);
      toast.error("Couldn't save the user", isApiError(error) ? error.message : "Something went wrong");
      throw error;
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {conflict ? <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Someone else saved this user. Reload to see their changes.</Callout> : null}
      <Wizard<F> steps={steps} variant="drawer" mode={editId ? "free" : "linear"} defaultValues={initial} draftScope={false} guardUnsaved={false} onDirtyChange={onDirtyChange} submitLabel={editId ? "Save" : "Create user"} onCancel={onCancel} onComplete={submit} />
    </div>
  );
}

export function UserWizardDrawer({ open, onOpenChange, editId, onSaved }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly editId: string | null; readonly onSaved: () => void }) {
  const [dirty, setDirty] = React.useState(false);
  const detail = useApiQuery<UserDetail>(["user", editId ?? ""], open && editId ? `/api/users/${editId}` : null, { staleTime: 0 });
  const close = () => { setDirty(false); onOpenChange(false); };
  const d = detail.data?.data;
  const initial = editId ? (d ? detailToUserForm(d) : null) : USER_FORM_DEFAULTS;
  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())} dirty={dirty} width={45}
      title={editId ? `Edit user${d ? ` · ${d.name}` : ""}` : "Add user"}
      description={editId ? "Change details, roles, warehouse and client access." : "Create a sign-in, then choose roles, warehouses and clients."}>
      {editId && detail.isError ? (
        <EmptyState title="Couldn't load this user" description={detail.error.message} action={<Button onClick={() => void detail.refetch()}>Retry</Button>} />
      ) : !initial ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Body key={editId ?? "new"} initial={initial} detail={d ?? null} onCancel={close} onDirtyChange={setDirty} onDone={() => { close(); onSaved(); }} />
      )}
    </Drawer>
  );
}
