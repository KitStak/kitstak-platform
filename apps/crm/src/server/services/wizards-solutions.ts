/**
 * Multi-board solution installs for the template center (wizards module). The CRM suite builds
 * a new workspace with Leads, Deals, Accounts, Contacts and Activities, wires every
 * connect-boards / mirror relation between them and adds the sales dashboard.
 */
import { z } from 'zod';
import { publish } from '@/server/realtime/publisher';
import { inTransaction, type ServiceContext } from './context';
import { provisionCrmWorkspace } from './onboarding';
import { CRM_SUITE_ID } from './wizards-gallery';

export const installSolutionSchema = z.object({
  solutionId: z.literal(CRM_SUITE_ID),
  workspaceName: z.string().trim().min(1, 'Workspace name is required').max(120),
  withSampleData: z.boolean().default(true),
});
export type InstallSolutionInput = z.infer<typeof installSolutionSchema>;

export interface InstalledSolutionDto {
  readonly workspaceId: string;
  readonly boards: readonly { readonly id: string; readonly name: string; readonly templateId: string }[];
  readonly dashboardId: string | null;
}

export async function installSolution(
  ctx: ServiceContext,
  input: InstallSolutionInput,
): Promise<InstalledSolutionDto> {
  return inTransaction(ctx, async (tx) => {
    const provisioned = await provisionCrmWorkspace(tx, {
      workspaceName: input.workspaceName,
      withSampleData: input.withSampleData,
    });
    await publish(tx.db, {
      type: 'workspace.changed',
      orgId: tx.orgId,
      ids: [provisioned.workspaceId],
      actorId: tx.userId,
    });
    return {
      workspaceId: provisioned.workspaceId,
      boards: provisioned.boards.map((entry) => ({
        id: entry.board.id,
        name: entry.board.name,
        templateId: entry.template.id,
      })),
      dashboardId: provisioned.dashboardId,
    };
  });
}
