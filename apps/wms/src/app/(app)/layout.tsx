import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { ShellSkeleton } from '@/components/layout/shell-skeleton';
import { getSessionResolution } from '@/server/auth/session';
import { loadShellProps } from '@/server/shell/shell-props';
import { loadLockView } from '@/server/tenancy/lock-view';

/**
 * Reads the session cookie (runtime data), so it lives inside a Suspense boundary for
 * cacheComponents prerendering; the shell streams in at request time. Permissions are
 * resolved here so the mega-menus render already filtered.
 */
async function AuthedShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const shell = await loadShellProps();
  if (!shell) {
    // Signed in, but no org of theirs has a warehouse yet: set one up (or explain who can).
    const resolution = await getSessionResolution();
    // A person who only manages billing has no seat here. The proxy sends them to the lock screen
    // first; this is the backstop for a move inside the app, so they never see the sign in form.
    if (!resolution.ok && resolution.reason !== 'unauthenticated' && (await loadLockView()).kind === 'billing_only') redirect('/locked');
    redirect(!resolution.ok && resolution.reason === 'no_warehouse' ? '/setup-warehouse' : '/login');
  }
  return (
    <>
      {shell.brandCss ? <style data-brand="custom-branding">{shell.brandCss}</style> : null}
      <AppShell
        user={shell.user}
        permissions={shell.permissions}
        initialContext={shell.initialContext}
        activeApps={shell.activeApps}
        entitledApps={shell.entitledApps}
        passwordChange={shell.passwordChange}
        idleMinutes={shell.idleMinutes}
        org={shell.org}
        orgs={shell.orgs}
        plan={shell.plan}
      >
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
