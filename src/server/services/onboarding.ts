/**
 * Onboarding: create an organization (caller becomes owner), a default "Sales CRM"
 * workspace built from the CRM templates (connected boards), and a sales dashboard.
 */
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { customAlphabet } from 'nanoid';
import { db as defaultDb, type Executor } from '@/server/db';
import {
  dashboardWidgets,
  dashboards,
  member,
  organization,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { ConflictError } from '@/server/http/errors';
import type { ServiceContext } from './context';
import type { BoardSummaryDto, OnboardingResultDto } from './contracts/dto';
import { toBoardSummaryDto, toWorkspaceDto } from './mappers';
import { initialPositions, positionAfter } from './positions';
import { CRM_WORKSPACE_TEMPLATE_IDS, findTemplate } from './templates/crm';
import {
  instantiateTemplate,
  wireTemplateConnections,
  type InstantiatedBoard,
} from './templates/instantiate';

const slugSuffix = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);

export const onboardingSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/, 'Use lowercase letters, digits and dashes')
    .optional(),
  workspaceName: z.string().trim().min(1).max(120).default('Sales CRM'),
  templateIds: z.array(z.string().max(64)).max(10).optional(),
  withSampleData: z.boolean().default(true),
  /** Optional profile details captured by the onboarding wizard. */
  teamSize: z.enum(['1', '2-5', '6-20', '21-100', '101-500', '500+']).optional(),
  useCase: z.string().max(120).optional(),
  /** Job role and the record types the user manages (role-aware onboarding, wizards module). */
  role: z.string().trim().max(60).optional(),
  manages: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});
export type OnboardingInput = z.infer<typeof onboardingSchema>;

export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return slug.length >= 2 ? slug : `org-${slugSuffix()}`;
}

async function uniqueSlug(executor: Executor, base: string, explicit: boolean): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${slugSuffix()}`;
    const [taken] = await executor
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
    if (explicit) throw new ConflictError('This URL is already taken');
  }
  return `${base}-${slugSuffix()}`;
}

export interface ProvisionedCrm {
  readonly workspaceId: string;
  readonly boards: readonly InstantiatedBoard[];
  readonly boardIdByTemplate: ReadonlyMap<string, string>;
  readonly dashboardId: string | null;
}

/** Build a connected CRM workspace inside an existing org (used by onboarding and the seed). */
export async function provisionCrmWorkspace(
  ctx: ServiceContext,
  options: {
    readonly workspaceName: string;
    readonly templateIds?: readonly string[];
    readonly withSampleData: boolean;
    readonly icon?: string;
    readonly color?: 'blue' | 'purple' | 'green' | 'orange' | 'teal';
    readonly existingBoardIdByTemplate?: ReadonlyMap<string, string>;
    readonly withDashboard?: boolean;
  },
): Promise<ProvisionedCrm> {
  const [lastWorkspace] = await ctx.db
    .select({ position: workspaces.position })
    .from(workspaces)
    .where(eq(workspaces.orgId, ctx.orgId))
    .orderBy(desc(workspaces.position))
    .limit(1);
  const [workspace] = await ctx.db
    .insert(workspaces)
    .values({
      orgId: ctx.orgId,
      name: options.workspaceName,
      icon: options.icon ?? 'Briefcase',
      color: options.color ?? 'blue',
      position: positionAfter(lastWorkspace?.position),
      createdBy: ctx.userId,
    })
    .returning();
  if (!workspace) throw new Error('Workspace insert returned no row');
  if (ctx.userId) {
    await ctx.db
      .insert(workspaceMembers)
      .values({ orgId: ctx.orgId, workspaceId: workspace.id, userId: ctx.userId, role: 'owner' })
      .onConflictDoNothing();
  }

  const templateIds = options.templateIds ?? CRM_WORKSPACE_TEMPLATE_IDS;
  const created: InstantiatedBoard[] = [];
  for (const templateId of templateIds) {
    const template = findTemplate(templateId);
    if (!template) continue;
    created.push(
      await instantiateTemplate(ctx, template, {
        workspaceId: workspace.id,
        withSampleData: options.withSampleData,
      }),
    );
  }
  const boardIdByTemplate = new Map(options.existingBoardIdByTemplate ?? []);
  for (const entry of created) boardIdByTemplate.set(entry.template.id, entry.board.id);
  await wireTemplateConnections(ctx, created, boardIdByTemplate);

  let dashboardId: string | null = null;
  if (options.withDashboard !== false && boardIdByTemplate.has('crm-deals')) {
    dashboardId = await createSalesDashboard(ctx, workspace.id, boardIdByTemplate);
  }
  return { workspaceId: workspace.id, boards: created, boardIdByTemplate, dashboardId };
}

/** Standard sales dashboard: pipeline value, win rate, stage funnel, leaderboard, lead sources. */
export async function createSalesDashboard(
  ctx: ServiceContext,
  workspaceId: string,
  boardIdByTemplate: ReadonlyMap<string, string>,
): Promise<string> {
  const deals = boardIdByTemplate.get('crm-deals');
  const leads = boardIdByTemplate.get('crm-leads');
  const activities = boardIdByTemplate.get('crm-activities');
  const boardIds = [deals, leads, activities].filter((id): id is string => Boolean(id));
  const [dashboard] = await ctx.db
    .insert(dashboards)
    .values({
      orgId: ctx.orgId,
      workspaceId,
      name: 'Sales Dashboard',
      description: 'Pipeline health, forecast and team performance at a glance.',
      config: { boardIds },
      position: initialPositions(1)[0] as string,
      createdBy: ctx.userId,
    })
    .returning({ id: dashboards.id });
  if (!dashboard) throw new Error('Dashboard insert returned no row');
  const dealBoards = deals ? [deals] : [];
  const open = { columnKey: 'stage', labelIds: ['won', 'lost'], exclude: true };
  const won = { columnKey: 'stage', labelIds: ['won'], exclude: false };
  const widgets = [
    {
      type: 'number' as const,
      title: 'Open pipeline',
      config: {
        boardIds: dealBoards,
        valueColumnKey: 'deal_value',
        aggregate: 'sum',
        filter: open,
        prefix: '$',
      },
      x: 0,
      y: 0,
      w: 4,
      h: 3,
    },
    {
      type: 'number' as const,
      title: 'Weighted forecast',
      config: {
        boardIds: dealBoards,
        valueColumnKey: 'forecast',
        aggregate: 'sum',
        filter: open,
        prefix: '$',
      },
      x: 4,
      y: 0,
      w: 4,
      h: 3,
    },
    {
      type: 'number' as const,
      title: 'Closed won',
      config: {
        boardIds: dealBoards,
        valueColumnKey: 'deal_value',
        aggregate: 'sum',
        filter: won,
        prefix: '$',
      },
      x: 8,
      y: 0,
      w: 4,
      h: 3,
    },
    {
      type: 'funnel' as const,
      title: 'Pipeline by stage',
      config: {
        boardIds: dealBoards,
        groupByColumnKey: 'stage',
        valueColumnKey: 'deal_value',
        aggregate: 'sum',
      },
      x: 0,
      y: 3,
      w: 6,
      h: 6,
    },
    {
      type: 'battery' as const,
      title: 'Deal stage mix',
      config: { boardIds: dealBoards, groupByColumnKey: 'stage', aggregate: 'count' },
      x: 6,
      y: 3,
      w: 6,
      h: 3,
    },
    {
      type: 'leaderboard' as const,
      title: 'Top performers (closed won)',
      config: {
        boardIds: dealBoards,
        groupByColumnKey: 'owner',
        valueColumnKey: 'deal_value',
        aggregate: 'sum',
        filter: won,
      },
      x: 6,
      y: 6,
      w: 6,
      h: 6,
    },
    {
      type: 'chart' as const,
      title: 'Leads by source',
      config: {
        boardIds: leads ? [leads] : [],
        groupByColumnKey: 'source',
        aggregate: 'count',
        chartType: 'donut',
      },
      x: 0,
      y: 9,
      w: 6,
      h: 6,
    },
    {
      type: 'chart' as const,
      title: 'Activities by type',
      config: {
        boardIds: activities ? [activities] : [],
        groupByColumnKey: 'type',
        aggregate: 'count',
        chartType: 'bar',
      },
      x: 0,
      y: 15,
      w: 6,
      h: 6,
    },
    {
      type: 'workload' as const,
      title: 'Open deals per rep',
      config: { boardIds: dealBoards, groupByColumnKey: 'owner', aggregate: 'count', filter: open },
      x: 6,
      y: 12,
      w: 6,
      h: 6,
    },
  ];
  await ctx.db
    .insert(dashboardWidgets)
    .values(widgets.map((widget) => ({ orgId: ctx.orgId, dashboardId: dashboard.id, ...widget })));
  return dashboard.id;
}

/** Create the org and its starter workspace for the signed-in user. */
export async function completeOnboarding(
  userId: string,
  input: OnboardingInput,
  executor: Executor = defaultDb,
): Promise<OnboardingResultDto> {
  return executor.transaction(async (tx) => {
    const slug = await uniqueSlug(
      tx,
      input.slug ?? slugify(input.organizationName),
      input.slug !== undefined,
    );
    const [org] = await tx
      .insert(organization)
      .values({
        name: input.organizationName,
        slug,
        createdAt: new Date(),
        metadata: JSON.stringify({
          teamSize: input.teamSize ?? null,
          useCase: input.useCase ?? null,
          role: input.role ?? null,
          manages: input.manages ?? null,
        }),
      })
      .returning();
    if (!org) throw new Error('Organization insert returned no row');
    const [existing] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, org.id), eq(member.userId, userId)))
      .limit(1);
    if (!existing)
      await tx
        .insert(member)
        .values({ organizationId: org.id, userId, role: 'owner', createdAt: new Date() });
    const ctx: ServiceContext = { db: tx, orgId: org.id, userId, roles: ['owner'] };
    const provisioned = await provisionCrmWorkspace(ctx, {
      workspaceName: input.workspaceName,
      templateIds: input.templateIds,
      withSampleData: input.withSampleData,
    });
    const [workspace] = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, provisioned.workspaceId))
      .limit(1);
    if (!workspace) throw new Error('Workspace missing after provisioning');
    const boardDtos: BoardSummaryDto[] = provisioned.boards.map((entry) => toBoardSummaryDto(entry.board));
    return {
      organization: { id: org.id, name: org.name, slug: org.slug },
      workspace: toWorkspaceDto(workspace),
      boards: boardDtos,
    };
  });
}
