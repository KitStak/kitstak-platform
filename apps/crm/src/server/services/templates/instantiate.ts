/**
 * Turns a `BoardTemplate` into rows (board, columns, groups, views, owner membership) and
 * wires connect_boards / mirror columns to sibling boards.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { boardMembers, boards, columns, groups, items, views } from '@/server/db/schema';
import { parseColumnSettings } from '@/server/db/schema/cell-values';
import { COLUMN_TYPE_REGISTRY, defaultStoredWidth } from '@/server/db/schema/column-types';
import type { ServiceContext } from '../context';
import { initialPositions, positionAfter } from '../positions';
import { findTemplate } from './crm';
import type { BoardTemplate } from './types';

export interface InstantiatedBoard {
  readonly board: typeof boards.$inferSelect;
  readonly template: BoardTemplate;
  readonly groupIds: ReadonlyMap<string, string>;
  readonly columnKeys: ReadonlySet<string>;
}

export interface InstantiateOptions {
  readonly workspaceId: string;
  readonly folderId?: string | null;
  readonly name?: string;
  readonly description?: string | null;
  readonly icon?: string | null;
  readonly privacy?: 'main' | 'private' | 'shareable';
  readonly itemTerminology?: string;
  readonly withSampleData?: boolean;
}

export async function instantiateTemplate(
  ctx: ServiceContext,
  template: BoardTemplate,
  options: InstantiateOptions,
): Promise<InstantiatedBoard> {
  const [lastBoard] = await ctx.db
    .select({ position: boards.position })
    .from(boards)
    .where(and(eq(boards.workspaceId, options.workspaceId), eq(boards.orgId, ctx.orgId)))
    .orderBy(desc(boards.position))
    .limit(1);

  const [board] = await ctx.db
    .insert(boards)
    .values({
      orgId: ctx.orgId,
      workspaceId: options.workspaceId,
      folderId: options.folderId ?? null,
      name: options.name ?? template.name,
      kind: template.kind,
      description: options.description ?? template.description,
      icon: options.icon ?? template.icon,
      privacy: options.privacy ?? 'main',
      itemTerminology: options.itemTerminology ?? template.itemTerminology,
      settings: {
        templateId: template.id,
        ...(template.subitemTerminology && { subitemTerminology: template.subitemTerminology }),
        ...(template.primaryStatusColumnKey && { primaryStatusColumnKey: template.primaryStatusColumnKey }),
      },
      position: positionAfter(lastBoard?.position),
      createdBy: ctx.userId,
    })
    .returning();
  if (!board) throw new Error('Board insert returned no row');

  const columnPositions = initialPositions(template.columns.length);
  await ctx.db.insert(columns).values(
    template.columns.map((column, index) => ({
      orgId: ctx.orgId,
      boardId: board.id,
      key: column.key,
      title: column.title,
      description: column.description ?? null,
      type: column.type,
      scope: column.scope ?? ('item' as const),
      settings: parseColumnSettings(
        column.type,
        column.settings ?? COLUMN_TYPE_REGISTRY[column.type].defaultSettings(),
      ),
      width: column.width ?? defaultStoredWidth(column.type, column.title),
      position: columnPositions[index] as string,
      hidden: column.hidden ?? false,
      createdBy: ctx.userId,
    })),
  );

  const groupPositions = initialPositions(template.groups.length);
  const groupRows = await ctx.db
    .insert(groups)
    .values(
      template.groups.map((group, index) => ({
        orgId: ctx.orgId,
        boardId: board.id,
        title: group.title,
        color: group.color,
        position: groupPositions[index] as string,
        collapsedDefault: group.collapsedDefault ?? false,
      })),
    )
    .returning({ id: groups.id });
  const groupIds = new Map(
    template.groups.map((group, index) => [group.key, groupRows[index]?.id as string]),
  );

  const viewPositions = initialPositions(template.views.length);
  await ctx.db.insert(views).values(
    template.views.map((view, index) => ({
      orgId: ctx.orgId,
      boardId: board.id,
      type: view.type,
      name: view.name,
      config: view.config,
      position: viewPositions[index] as string,
      isDefault: view.isDefault ?? false,
      createdBy: ctx.userId,
    })),
  );

  if (ctx.userId) {
    await ctx.db
      .insert(boardMembers)
      .values({ orgId: ctx.orgId, boardId: board.id, userId: ctx.userId, role: 'owner' })
      .onConflictDoNothing();
  }

  if (options.withSampleData && template.sampleItems?.length) {
    const byGroup = new Map<string, number>();
    const keys = new Map<string, string[]>();
    for (const sample of template.sampleItems)
      byGroup.set(sample.group, (byGroup.get(sample.group) ?? 0) + 1);
    for (const [group, count] of byGroup) keys.set(group, initialPositions(count));
    const cursor = new Map<string, number>();
    await ctx.db.insert(items).values(
      template.sampleItems.map((sample) => {
        const index = cursor.get(sample.group) ?? 0;
        cursor.set(sample.group, index + 1);
        return {
          orgId: ctx.orgId,
          boardId: board.id,
          groupId: (groupIds.get(sample.group) ?? groupRows[0]?.id) as string,
          name: sample.name,
          position: keys.get(sample.group)?.[index] as string,
          values: (sample.values ?? {}) as Record<string, never>,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        };
      }),
    );
  }

  return { board, template, groupIds, columnKeys: new Set(template.columns.map((column) => column.key)) };
}

/**
 * Wire connect_boards and mirror columns. `boardIdByTemplate` maps template ids to board ids
 * created in the same set; missing targets are looked up by board kind in the workspace.
 */
export async function wireTemplateConnections(
  ctx: ServiceContext,
  created: readonly InstantiatedBoard[],
  boardIdByTemplate: ReadonlyMap<string, string>,
): Promise<void> {
  const resolved = new Map(boardIdByTemplate);
  const workspaceId = created[0]?.board.workspaceId;
  const missing = new Set<string>();
  for (const entry of created) {
    for (const column of entry.template.columns) {
      const target = column.connectTemplate ?? column.mirrorOf?.templateId;
      if (target && !resolved.has(target)) missing.add(target);
    }
  }
  if (workspaceId && missing.size > 0) {
    const kinds = [...missing].map((id) => findTemplate(id)?.kind).filter((kind) => kind !== undefined);
    if (kinds.length > 0) {
      const candidates = await ctx.db
        .select({ id: boards.id, kind: boards.kind })
        .from(boards)
        .where(
          and(
            eq(boards.orgId, ctx.orgId),
            eq(boards.workspaceId, workspaceId),
            inArray(boards.kind, kinds),
            isNull(boards.deletedAt),
          ),
        )
        .orderBy(boards.position);
      for (const templateId of missing) {
        const kind = findTemplate(templateId)?.kind;
        const match = candidates.find((candidate) => candidate.kind === kind);
        if (match) resolved.set(templateId, match.id);
      }
    }
  }

  for (const entry of created) {
    for (const column of entry.template.columns) {
      let settings: Record<string, unknown> | null = null;
      if (column.type === 'connect_boards' && column.connectTemplate) {
        const target = resolved.get(column.connectTemplate);
        if (!target) continue;
        const targetIsInSet = boardIdByTemplate.has(column.connectTemplate);
        settings = parseColumnSettings('connect_boards', {
          ...(column.settings ?? {}),
          boardIds: [target],
          ...(column.reciprocalKey && targetIsInSet ? { reciprocalColumnKey: column.reciprocalKey } : {}),
        });
      } else if (column.type === 'mirror' && column.mirrorOf) {
        const target = resolved.get(column.mirrorOf.templateId);
        if (!target) continue;
        settings = parseColumnSettings('mirror', {
          ...(column.settings ?? {}),
          mirroredColumnKeys: { [target]: column.mirrorOf.columnKey },
        });
      }
      if (!settings) continue;
      await ctx.db
        .update(columns)
        .set({ settings: settings as never })
        .where(
          and(eq(columns.boardId, entry.board.id), eq(columns.key, column.key), eq(columns.orgId, ctx.orgId)),
        );
    }
  }
}
