'use client';
/**
 * Shell slot implementations: register with `slots={{ ...wizardSlots }}` on <AppShell> (see
 * src/app/(app)/[orgSlug]/shell-client.tsx). Every "+ Add" entry point in the shell, the
 * command palette and the top-bar Invite button then opens these wizards. Create wizards the
 * caller's role can't use close straight away with an explanatory toast; the template center
 * stays browsable read-only.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { toast } from '@/components/ui';
import type { AppShellSlots } from '@/features/shell/app-shell';
import { useOrg } from '@/features/shell/org-context';
import { AddFolderDialog } from './add-folder-dialog';
import { AddWorkspaceDialog } from './add-workspace-dialog';
import { CreateBoardWizard } from './create-board-wizard';
import { InviteMembersDialog } from './invite-members-dialog';
import { canOpenWizard, deniedMessage, type WizardKind } from './model/permissions';

function Gate({ kind, onClose, children }: { readonly kind: WizardKind; readonly onClose: () => void; readonly children: ReactNode }) {
  const { permissions } = useOrg();
  const allowed = canOpenWizard(kind, permissions);
  const notified = useRef(false);
  useEffect(() => {
    if (allowed || notified.current) return;
    notified.current = true;
    toast.error('You don’t have permission to do that', `${deniedMessage(kind)}.`);
    onClose();
  }, [allowed, kind, onClose]);
  return allowed ? <>{children}</> : null;
}

export const wizardSlots: Pick<AppShellSlots, 'createBoard' | 'createWorkspace' | 'createFolder' | 'invite'> = {
  createBoard: (request, onClose) => {
    const wizard = (
      <CreateBoardWizard
        open
        onClose={onClose}
        workspaceId={request.workspaceId}
        folderId={request.folderId ?? null}
        start={request.mode === 'templates' ? 'templates' : 'setup'}
        templateId={request.templateId}
      />
    );
    // Browsing templates is fine for every role; the quick-create form is not.
    if (request.mode === 'templates' || request.templateId) return wizard;
    return (
      <Gate kind="board" onClose={onClose}>
        {wizard}
      </Gate>
    );
  },
  createWorkspace: (_request, onClose) => (
    <Gate kind="workspace" onClose={onClose}>
      <AddWorkspaceDialog open onClose={onClose} />
    </Gate>
  ),
  createFolder: (request, onClose) => (
    <Gate kind="folder" onClose={onClose}>
      <AddFolderDialog open onClose={onClose} workspaceId={request.workspaceId} parentFolderId={request.folderId ?? null} />
    </Gate>
  ),
  invite: (onClose) => <InviteMembersDialog open onClose={onClose} />,
};
