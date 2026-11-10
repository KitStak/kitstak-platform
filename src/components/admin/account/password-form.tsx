"use client";

/**
 * Change Password: current / new / re-enter with the live policy meter. POST
 * /api/account/password ends every other session and re-issues this browser's session.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useWatch } from "react-hook-form";
import { useApiMutation } from "@/lib/query-client";
import { accountPasswordSchema, type AccountPasswordValues } from "@/lib/grid-defs/admin/account";
import { Callout } from "@/components/ui/callout";
import { Form, FormField, SubmitBar, useZodForm } from "@/components/ui/form";
import { TextField } from "@/components/ui/text-field";
import { PasswordMeter, usePasswordPolicy } from "../password-meter";

const EMPTY: AccountPasswordValues = { currentPassword: "", newPassword: "", confirmPassword: "" };
type K = keyof AccountPasswordValues;

function Field({ name, label, autoComplete, describedBy }: { readonly name: K; readonly label: string; readonly autoComplete: string; readonly describedBy?: string }) {
  return (
    <FormField<AccountPasswordValues> name={name} label={label} required>
      {(c) => (
        <TextField id={c.id} name={c.name} ref={c.ref as React.Ref<HTMLInputElement>} type="password" autoComplete={autoComplete}
          value={(c.value as string | null) ?? ""} onChange={(e) => c.onChange(e.target.value)} onBlur={c.onBlur} invalid={c.invalid}
          aria-invalid={c["aria-invalid"]} aria-describedby={[c["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined} />
      )}
    </FormField>
  );
}

export function AccountPasswordForm({ mustChange, reason = null, maxAgeDays }: { readonly mustChange: boolean; readonly reason?: "reset" | "expired" | null; readonly maxAgeDays: number | null }) {
  const router = useRouter();
  const policy = usePasswordPolicy();
  const form = useZodForm(accountPasswordSchema, EMPTY);
  const newPassword = useWatch({ control: form.control, name: "newPassword" }) ?? "";
  const mutation = useApiMutation<AccountPasswordValues, unknown, AccountPasswordValues>({
    path: "/api/account/password",
    method: "POST",
    form,
    successTitle: "Password changed",
    successMessage: "Every other device was signed out. This browser stays signed in.",
    onSuccess: () => {
      form.reset(EMPTY);
      // A forced change (reset or expiry) unlocks the rest of the app: re-run the shell gate.
      if (mustChange) router.refresh();
    },
  });
  return (
    <div className="flex flex-col gap-4">
      {mustChange ? (
        <Callout variant="attention" title="Choose a new password to keep working">
          {reason === "reset"
            ? "An administrator reset your password. Choose your own password to unlock the rest of KitStaks."
            : `Your password is older than ${maxAgeDays ?? "the allowed number of"} days, your company's limit. Choose a new one to unlock the rest of KitStaks.`}
        </Callout>
      ) : null}
      <Form form={form} onSubmit={(v) => mutation.mutateAsync(v)} className="flex flex-col gap-4" guardUnsaved>
        <Field name="currentPassword" label="Current password" autoComplete="current-password" />
        <div>
          <Field name="newPassword" label="New password" autoComplete="new-password" describedBy="account-password-meter" />
          <PasswordMeter id="account-password-meter" password={newPassword} policy={policy} />
        </div>
        <Field name="confirmPassword" label="Re-enter new password" autoComplete="new-password" />
        {maxAgeDays ? <p className="text-[12px] text-faint">Passwords expire every {maxAgeDays} days under your company&apos;s policy.</p> : null}
        <SubmitBar submitLabel="Change password" cancelLabel="Clear" onCancel={() => form.reset(EMPTY)} pending={mutation.isPending} />
      </Form>
    </div>
  );
}
