'use client';
/**
 * Open any wizard from anywhere inside the app shell (home quick actions, empty states,
 * workspace page). Requests go through the shell store, so the registered slots render them.
 */
import { useMemo } from 'react';
import { toast } from '@/components/ui';
import { useOrg } from '@/features/shell/org-context';
import { useShellStore } from '@/features/shell/store';
import { canOpenWizard, deniedMessage, type WizardKind } from './model/permissions';

export interface OpenBoardOptions {
  readonly workspaceId?: string;
  readonly folderId?: string | null;
  readonly templateId?: string;
}

export interface WizardOpeners {
  /** Quick create (name, terminology, privacy) with a "Browse templates" escape hatch. */
  readonly createBoard: (options?: OpenBoardOptions) => void;
  /** Full-screen template center. */
  readonly templates: (options?: OpenBoardOptions) => void;
  readonly workspace: () => void;
  readonly folder: (options?: { readonly workspaceId?: string; readonly parentFolderId?: string | null }) => void;
  readonly invite: () => void;
}

export function useOpenWizard(): WizardOpeners {
  const requestCreate = useShellStore((state) => state.requestCreate);
  const openPanel = useShellStore((state) => state.openPanel);
  const { permissions } = useOrg();
  return useMemo(() => {
    /** Refuse up front (with a toast) instead of letting someone fill a form they can't submit. */
    const allowed = (kind: WizardKind) => {
      if (canOpenWizard(kind, permissions)) return true;
      toast.error('You don’t have permission to do that', `${deniedMessage(kind)}.`);
      return false;
    };
    return {
      createBoard: (options = {}) => {
        if (allowed('board')) requestCreate({ kind: 'board', ...options });
      },
      // The template center stays browsable for every role (read-only without board:create).
      templates: (options = {}) => requestCreate({ kind: 'board', mode: 'templates', ...options }),
      workspace: () => {
        if (allowed('workspace')) requestCreate({ kind: 'workspace' });
      },
      folder: (options = {}) => {
        if (allowed('folder'))
          requestCreate({ kind: 'folder', workspaceId: options.workspaceId, folderId: options.parentFolderId ?? null });
      },
      invite: () => openPanel('invite'),
    };
  }, [requestCreate, openPanel, permissions]);
}
