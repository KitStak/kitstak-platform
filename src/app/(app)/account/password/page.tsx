import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppDb } from "@/server/api/db";
import { getAuthContext } from "@/server/auth/context";
import { requirePagePermission } from "@/server/auth/permissions";
import { getPasswordPolicy, isPasswordExpired } from "@/server/auth/password-policy";
import { loadUser } from "@/server/repositories/users";
import { PageHeader } from "@/components/layout/page-header";
import { AccountShell } from "@/components/layout/account/account-shell";
import { AccountPasswordForm } from "@/components/admin/account/password-form";
import { PasswordPolicySeed } from "@/components/admin/password-meter";
import { SkeletonText } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Change Password" };

const ROUTE = "/account/password";

async function PasswordBody() {
  await requirePagePermission("settings.change_password.view", ROUTE);
  const auth = await getAuthContext();
  if (!auth) redirect(`/login?next=${encodeURIComponent(ROUTE)}`);
  const db = await getAppDb();
  const policy = getPasswordPolicy(db);
  const user = loadUser(db, auth.user.id);
  const mustChange = !user.passwordChangedAt || isPasswordExpired(user.passwordChangedAt, policy);
  return (
    <PasswordPolicySeed policy={{ minLength: policy.minLength, requireUpper: policy.requireUpper, requireNumber: policy.requireNumber, requireSymbol: policy.requireSymbol }}>
      <AccountPasswordForm mustChange={mustChange} reason={!user.passwordChangedAt ? "reset" : mustChange ? "expired" : null} maxAgeDays={policy.maxAgeDays ?? null} />
    </PasswordPolicySeed>
  );
}

/** `/account/password` — current / new / re-enter with the company password policy. */
export default function ChangePasswordPage() {
  return (
    <>
      <PageHeader title="Change Password" helper="Make your password unique and strong. Changing it signs you out on every other device." />
      <AccountShell active="password" title="Change password" description="Your new password must meet your company's policy.">
        <Suspense fallback={<SkeletonText lines={5} />}>
          <PasswordBody />
        </Suspense>
      </AccountShell>
    </>
  );
}
