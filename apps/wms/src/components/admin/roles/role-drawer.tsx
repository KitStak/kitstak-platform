"use client";

/**
 * Add / Edit / View Role drawer: name, description, category and the permission matrix.
 * System roles open read-only with a Duplicate action. Stale edits show the Reload prompt.
 */
import * as React from "react";
import { Copy, Pencil, Lock } from "lucide-react";
import { useFormState } from "react-hook-form";
import type { z } from "zod";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors, useApiQuery } from "@/lib/query-client";
import { ROLE_CATEGORIES } from "@/lib/enums";
import { ROLE_FORM_DEFAULTS, roleSchema, type RoleFormValues } from "@/lib/grid-defs/admin/roles";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Form, FormField, FormGrid, FormSection, SubmitBar, useZodForm } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import type { RoleDetail } from "@/server/repositories/roles";
import { NO_PERMISSION } from "../admin-shared";
import { SelectField, TextInput } from "../form-controls";
import { PermissionMatrix } from "./permission-matrix";

type F = RoleFormValues;

function DirtyReporter({ form, onDirty }: { readonly form: ReturnType<typeof useZodForm<typeof roleSchema>>; readonly onDirty: (d: boolean) => void }) {
  const { isDirty } = useFormState({ control: form.control });
  React.useEffect(() => onDirty(isDirty), [isDirty, onDirty]);
  return null;
}

const REQUIRED_FIELDS = ["name", "description"] as const;

/**
 * Once any required field reports an error, validate every required field together, so an
 * empty Description is flagged next to an empty Name (Create is disabled while errors exist).
 * Errored fields then re-validate on every keystroke, so a fix clears its message at once.
 */
function RevealRequiredErrors({ form }: { readonly form: ReturnType<typeof useZodForm<typeof roleSchema>> }) {
  const { errors } = useFormState({ control: form.control });
  const hasError = REQUIRED_FIELDS.some((f) => Boolean(errors[f]));
  React.useEffect(() => { if (hasError) void form.trigger([...REQUIRED_FIELDS]); }, [hasError, form]);
  React.useEffect(() => {
    const sub = form.watch((_v, { name }) => {
      if (name && (REQUIRED_FIELDS as readonly string[]).includes(name) && form.getFieldState(name as (typeof REQUIRED_FIELDS)[number]).error) void form.trigger(name as (typeof REQUIRED_FIELDS)[number]);
    });
    return () => sub.unsubscribe();
  }, [form]);
  return null;
}

function RoleForm({ initial, detail, readOnly, onDone, onCancel, onDirty, onDuplicate, canDuplicate, onEdit }: {
  readonly initial: F; readonly detail: RoleDetail | null; readonly readOnly: boolean; readonly onDone: () => void; readonly onCancel: () => void;
  readonly onDirty: (d: boolean) => void; readonly onDuplicate: () => void; readonly canDuplicate: boolean; readonly onEdit?: () => void;
}) {
  const form = useZodForm(roleSchema, initial);
  const [conflict, setConflict] = React.useState(false);
  const submit = async (values: z.output<typeof roleSchema>) => {
    try {
      if (detail) await apiRequest(`/api/roles/${detail.id}`, { method: "PATCH", body: { ...values, version: detail.version } });
      else await apiRequest("/api/roles", { method: "POST", body: values });
      toast.success(detail ? "Role updated" : "Role created", `${values.name} · ${values.permissions.length} permissions. Changes apply on the users' next click.`);
      form.reset(values);
      onDone();
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      applyServerFieldErrors(form, error);
      toast.error("Couldn't save the role", isApiError(error) ? error.message : "Something went wrong");
    }
  };
  return (
    <Form form={form} onSubmit={submit} className="flex flex-col gap-5">
      <DirtyReporter form={form} onDirty={onDirty} />
      {readOnly ? null : <RevealRequiredErrors form={form} />}
      {conflict ? <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Someone else saved this role. Reload to see their changes.</Callout> : null}
      {readOnly && detail?.isSystem ? (
        <Callout variant="info" title="System role" action={canDuplicate ? <Button size="sm" variant="secondary" onClick={onDuplicate}><Copy className="h-3.5 w-3.5" aria-hidden />Duplicate</Button> : undefined}>
          {detail.name} is built in and can&apos;t be changed. Duplicate it to make an editable copy.
        </Callout>
      ) : null}
      <FormSection title="Role">
        <div className="flex flex-col gap-4">
          <FormGrid>
            <TextInput<F> name="name" label="Name" required maxLength={60} disabled={readOnly} placeholder="e.g. Shift lead" />
            <SelectField<F> name="category" label="Role category" required disabled={readOnly} options={ROLE_CATEGORIES.map((c) => ({ value: c, label: c }))} info="Client roles are offered to client users" />
          </FormGrid>
          <TextInput<F> name="description" label="Description" required maxLength={250} showCount disabled={readOnly} placeholder="What this role is for" />
        </div>
      </FormSection>
      <FormSection title="Permissions" description="Each page lists its actions. Use a page's checkbox to grant or revoke all of its actions.">
        <FormField<F> name="permissions">
          {(c) => <PermissionMatrix value={(c.value as string[] | null) ?? []} onChange={(keys) => c.onChange(keys)} readOnly={readOnly} />}
        </FormField>
      </FormSection>
      {readOnly ? (
        <div className="flex justify-end gap-2 border-t border-border pt-3 pb-3"><Button variant="secondary" onClick={onCancel}>Close</Button>{onEdit ? <Button variant="primary" onClick={onEdit}><Pencil className="h-3.5 w-3.5" aria-hidden />Edit</Button> : null}</div>
      ) : (
        <SubmitBar submitLabel={detail ? "Save" : "Create role"} onCancel={onCancel} requireDirty={Boolean(detail)} sticky />
      )}
    </Form>
  );
}


export function RoleDrawer({ open, onOpenChange, roleId, onSaved, canEdit, canCreate, onDuplicated, view = false }: {
  readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly roleId: string | null; readonly onSaved: () => void;
  readonly canEdit: boolean; readonly canCreate: boolean; readonly onDuplicated: (id: string) => void;
  /** Open an existing role read-only (Show details); an Edit button switches to edit mode. */
  readonly view?: boolean;
}) {
  const [dirty, setDirty] = React.useState(false);
  const [editing, setEditing] = React.useState(!view);
  React.useEffect(() => { if (open) setEditing(!view); }, [open, view, roleId]);
  const q = useApiQuery<RoleDetail>(["role", roleId ?? ""], open && roleId ? `/api/roles/${roleId}` : null, { staleTime: 0 });
  const d = q.data?.data;
  const locked = Boolean(d?.isSystem) || (Boolean(roleId) && !canEdit);
  const readOnly = locked || (Boolean(roleId) && !editing);
  const close = () => { setDirty(false); onOpenChange(false); };
  const initial: F | null = roleId ? (d ? { name: d.name, description: d.description ?? "", category: d.category as F["category"], permissions: [...d.permissions] } : null) : ROLE_FORM_DEFAULTS;
  const duplicate = async () => {
    if (!d) return;
    try {
      const { data } = await apiRequest<{ id: string; name: string }>(`/api/roles/${d.id}/duplicate`, { method: "POST" });
      toast.success("Role duplicated", `${data.name} is ready to edit.`);
      onSaved();
      onDuplicated(data.id);
    } catch (error) {
      toast.error("Couldn't duplicate the role", isApiError(error) ? error.message : "Something went wrong");
    }
  };
  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())} dirty={dirty} width={60} bodyClassName="pb-0"
      title={roleId ? (d ? (readOnly ? <span className="inline-flex items-center gap-2"><Lock className="h-4 w-4 text-faint" aria-hidden />{d.name}</span> : `Edit role · ${d.name}`) : "Role") : "Add role"}
      description={d ? `${d.userCount} ${d.userCount === 1 ? "user" : "users"} · ${d.permissions.length} of ${d.totalPermissions} permissions` : "Name the role, then choose what it can see and do."}
      headerExtra={d && !d.isSystem && roleId ? (
        <DisabledReason reason={canCreate ? null : NO_PERMISSION}><Button size="sm" variant="ghost" disabled={!canCreate} onClick={() => void duplicate()}><Copy className="h-3.5 w-3.5" aria-hidden />Duplicate</Button></DisabledReason>
      ) : undefined}>
      {roleId && q.isError ? (
        <EmptyState title="Couldn't load this role" description={q.error.message} action={<Button onClick={() => void q.refetch()}>Retry</Button>} />
      ) : !initial ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <RoleForm key={`${roleId ?? "new"}-${d?.version ?? 0}-${readOnly}`} initial={initial} detail={d ?? null} readOnly={readOnly} onEdit={readOnly && !locked ? () => setEditing(true) : undefined} onCancel={close} onDirty={setDirty}
          onDone={() => { close(); onSaved(); }} onDuplicate={() => void duplicate()} canDuplicate={canCreate} />
      )}
    </Drawer>
  );
}
