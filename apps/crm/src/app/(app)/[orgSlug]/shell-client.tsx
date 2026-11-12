'use client';
/**
 * Client boundary for the app shell. Feature agents register their shell slots here
 * (notifications panel, board-creation wizard, record search groups) — functions cannot cross
 * the server → client boundary, so they are wired on this side.
 *
 * Also mounts the data-layer `OrgProvider` (src/lib/hooks) so every API hook inside the
 * authenticated app is scoped to the active organization.
 */
import type { ReactNode } from 'react';
import { AppShell, type AppShellSlots } from '@/features/shell/app-shell';
import type { OrgContextValue } from '@/features/shell/org-context';
import { OrgProvider as DataOrgProvider } from '@/lib/hooks/org-context';
import { WizardDeepLink, wizardSlots } from '@/features/wizards';
import { NotificationsPanel } from '@/features/notifications';

const SLOTS: AppShellSlots = {
  ...wizardSlots,
  notificationsPanel: (onClose) => (
    <NotificationsPanel open onOpenChange={(open) => (open ? undefined : onClose())} />
  ),
};

export function ShellClient({
  context,
  children,
}: {
  readonly context: OrgContextValue;
  readonly children: ReactNode;
}) {
  return (
    <DataOrgProvider orgId={context.org.id}>
      <AppShell context={context} slots={SLOTS}>
        <WizardDeepLink />
        {children}
      </AppShell>
    </DataOrgProvider>
  );
}
