"use client";

/**
 * My Profile: display, first and last name, email and language (PATCH /api/account/profile).
 * Changing the email asks for the current password. Roles and access are shown read-only.
 */
import * as React from "react";
import Link from "next/link";
import { useWatch } from "react-hook-form";
import { ME_QUERY_KEY } from "@/lib/permissions-client";
import { useApiMutation } from "@/lib/query-client";
import { useFormat } from "@/lib/format";
import { profileSchema, type ProfileValues } from "@/lib/grid-defs/admin/account";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Form, FormField, FormGrid, SubmitBar, useZodForm } from "@/components/ui/form";
import { TextField } from "@/components/ui/text-field";
import { TextInput } from "../form-controls";

export interface ProfileData {
  readonly displayName: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly roles: readonly string[];
  readonly warehouses: readonly string[];
  readonly allClients: boolean;
  readonly clientCount: number;
  readonly userType: string;
  readonly lastLoginAt: string | null;
  readonly passwordChangedAt: string | null;
}

export function ProfileForm({ profile }: { readonly profile: ProfileData }) {
  const fmt = useFormat();
  const initial: ProfileValues = { displayName: profile.displayName, firstName: profile.firstName, lastName: profile.lastName, email: profile.email, currentPassword: "" };
  const form = useZodForm(profileSchema, initial);
  const email = useWatch({ control: form.control, name: "email" }) ?? "";
  const displayName = useWatch({ control: form.control, name: "displayName" }) ?? profile.displayName;
  const emailChanged = email.trim().toLowerCase() !== profile.email;
  const mutation = useApiMutation<ProfileValues, unknown, ProfileValues>({
    path: "/api/account/profile",
    method: "PATCH",
    invalidate: [ME_QUERY_KEY],
    form,
    successTitle: "Profile updated",
    successMessage: "Your name and email are saved.",
    onSuccess: (_d, vars) => form.reset({ ...vars, currentPassword: "" }),
  });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Avatar name={displayName || profile.displayName} size="lg" tone="brand" />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-foreground">{displayName || profile.displayName}</p>
          <p className="flex flex-wrap items-center gap-1 text-[12px] text-faint">
            {profile.roles.map((r) => <Badge key={r} tone="primary" size="sm" shape="pill">{r}</Badge>)}
            <span>· {profile.userType} user</span>
          </p>
        </div>
      </div>
      <Form form={form} onSubmit={(v) => mutation.mutateAsync(v)} className="flex flex-col gap-4" guardUnsaved>
        <TextInput<ProfileValues> name="displayName" label="Display name" required maxLength={80} info="Shown in the header, on tasks and in change logs" />
        <FormGrid>
          <TextInput<ProfileValues> name="firstName" label="First name" required maxLength={60} />
          <TextInput<ProfileValues> name="lastName" label="Last name" required maxLength={60} />
        </FormGrid>
        <TextInput<ProfileValues> name="email" label="Email" required maxLength={254} transform={(v) => v.trim()} info="Used to sign in" />
        {emailChanged ? (
          <FormField<ProfileValues> name="currentPassword" label="Current password" required description="Confirm it's you to change your sign-in email.">
            {(c) => <TextField id={c.id} name={c.name} ref={c.ref as React.Ref<HTMLInputElement>} type="password" autoComplete="current-password" value={(c.value as string | null) ?? ""} onChange={(e) => c.onChange(e.target.value)} onBlur={c.onBlur} invalid={c.invalid} aria-invalid={c["aria-invalid"]} aria-describedby={c["aria-describedby"]} />}
          </FormField>
        ) : null}
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-body">Language</span>
          <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-[13px] text-foreground">English (United States)</p>
        </div>
        <SubmitBar submitLabel="Update my profile" cancelLabel="Reset" requireDirty onCancel={() => form.reset(initial)} pending={mutation.isPending} />
      </Form>
      <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-y-2 border-t border-border pt-4 text-[13px]">
        <dt className="text-secondary">Warehouses</dt><dd className="text-foreground">{profile.warehouses.join(", ") || "None assigned"}</dd>
        <dt className="text-secondary">Clients</dt><dd className="text-foreground">{profile.allClients ? "All clients" : `${profile.clientCount} assigned`}</dd>
        <dt className="text-secondary">Last sign-in</dt><dd className="text-foreground">{profile.lastLoginAt ? fmt.dateTime(profile.lastLoginAt) : "—"}</dd>
        <dt className="text-secondary">Password changed</dt>
        <dd className="text-foreground">{profile.passwordChangedAt ? fmt.dateTime(profile.passwordChangedAt) : "Change required"} · <Link href="/account/password" className="font-medium text-primary hover:underline">Change password</Link></dd>
      </dl>
      <p className="text-[12px] text-faint">Roles, warehouses and client access are managed by an administrator in Users & Roles.</p>
    </div>
  );
}
