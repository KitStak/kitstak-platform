import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ShellSkeleton } from "@/components/layout/shell-skeleton";
import { loadShellProps } from "@/server/shell/shell-props";

/**
 * Reads the session cookie (runtime data), so it lives inside a Suspense boundary for
 * cacheComponents prerendering; the shell streams in at request time. Permissions are
 * resolved here so the mega-menus render already filtered.
 */
async function AuthedShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const shell = await loadShellProps();
  if (!shell) redirect("/login");
  return (
    <>
    {shell.brandCss ? <style data-brand="custom-branding">{shell.brandCss}</style> : null}
    <AppShell user={shell.user} permissions={shell.permissions} initialContext={shell.initialContext} activeApps={shell.activeApps} passwordChange={shell.passwordChange} idleMinutes={shell.idleMinutes}>
      {children}
    </AppShell>
    </>
  );
}

/**
 * The shell gates on the session (cookies) and redirects to /login, so the layout is
 * allowed to block; pages beneath can still opt into `instant = true` individually.
 */
export const instant = false;

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AuthedShell>{children}</AuthedShell>
    </Suspense>
  );
}
