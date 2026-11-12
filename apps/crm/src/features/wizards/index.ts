/**
 * Wizards module public API.
 *
 * - `wizardSlots`: AppShell slot implementations (create board / template center, workspace,
 *   folder, invite). Registered in src/app/(app)/[orgSlug]/shell-client.tsx.
 * - `useOpenWizard()`: open any wizard from feature code inside the shell
 *   (`templates()`, `createBoard()`, `workspace()`, `folder()`, `invite()`).
 * - `WizardDeepLink`: handles `?wizard=templates&template=crm-deals` style deep links.
 * - Components for direct use: CreateBoardWizard, AddWorkspaceDialog, AddFolderDialog,
 *   InviteMembersDialog, OnboardingFlow (the /welcome flow).
 */
export { wizardSlots } from './slots';
export { useOpenWizard, type OpenBoardOptions, type WizardOpeners } from './use-open-wizard';
export { WizardDeepLink } from './wizard-deep-link';
export { CreateBoardWizard, type CreateBoardWizardProps } from './create-board-wizard';
export { AddWorkspaceDialog } from './add-workspace-dialog';
export { AddFolderDialog } from './add-folder-dialog';
export { InviteMembersDialog } from './invite-members-dialog';
export { OnboardingFlow } from './onboarding/onboarding-flow';
