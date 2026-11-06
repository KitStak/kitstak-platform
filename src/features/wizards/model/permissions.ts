/**
 * Which permission each wizard needs, and the message shown when the role lacks it (pure).
 * Mirrors the API: POST /boards → board:create, POST /workspaces · /folders · /wizards/solutions
 * → workspace:write, POST /wizards/invitations → member:invite.
 */
import type { Permission } from '@/server/rbac/permissions';

export type WizardKind = 'board' | 'workspace' | 'folder' | 'invite' | 'solution';

export const WIZARD_PERMISSIONS: Readonly<Record<WizardKind, readonly Permission[]>> = {
  board: ['board:create'],
  workspace: ['workspace:write'],
  folder: ['workspace:write'],
  invite: ['member:invite'],
  solution: ['workspace:write', 'board:create'],
};

const DENIED: Readonly<Record<WizardKind, string>> = {
  board: 'Ask an admin to create boards',
  workspace: 'Ask an admin to create workspaces',
  folder: 'Ask an admin to create folders',
  invite: 'Ask an admin to invite people',
  solution: 'Ask an admin to install the CRM suite',
};

export function canOpenWizard(kind: WizardKind, permissions: readonly string[]): boolean {
  return WIZARD_PERMISSIONS[kind].every((permission) => permissions.includes(permission));
}

export function deniedMessage(kind: WizardKind): string {
  return DENIED[kind];
}
