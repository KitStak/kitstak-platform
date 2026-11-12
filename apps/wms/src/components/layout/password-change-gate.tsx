"use client";

/**
 * Forced password change (admin reset or company max age passed). Every in-app route except
 * `/account/password` is replaced by this gate and redirected there, so the expiry banner on
 * Change Password is always backed by enforcement. The server-rendered layout re-evaluates on
 * `router.refresh()` after a successful change, which lifts the gate.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";

export const PASSWORD_CHANGE_PATH = "/account/password";

/** Pure: routes that stay reachable while a password change is pending. */
export function allowedDuringPasswordChange(pathname: string | null): boolean {
  return pathname === PASSWORD_CHANGE_PATH || (pathname?.startsWith(`${PASSWORD_CHANGE_PATH}/`) ?? false);
}

export function PasswordChangeGate({ reason, children }: { readonly reason: "reset" | "expired" | null; readonly children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const blocked = reason !== null && !allowedDuringPasswordChange(pathname);
  React.useEffect(() => {
    if (blocked) router.replace(PASSWORD_CHANGE_PATH);
  }, [blocked, router]);
  if (!blocked) return <>{children}</>;
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div role="alert" className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-surface p-6 text-center shadow-sm">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-warning-soft text-warning"><KeyRound className="h-5 w-5" aria-hidden /></span>
        <h1 className="text-md font-semibold text-foreground">Choose a new password to continue</h1>
        <p className="text-sm text-secondary">
          {reason === "reset" ? "An administrator reset your password." : "Your password has passed your company's maximum age."} Opening Change Password…
        </p>
        <Link href={PASSWORD_CHANGE_PATH} className="text-sm font-semibold text-primary hover:underline">Go to Change Password</Link>
      </div>
    </div>
  );
}
