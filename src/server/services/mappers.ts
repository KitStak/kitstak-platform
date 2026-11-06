/** Row → DTO mappers (pure). */
import type {
  boards,
  columns,
  dashboardWidgets,
  folders,
  groups,
  items,
  views,
  workspaces,
} from '@/server/db/schema';
import type {
  BoardSummaryDto,
  ColumnDto,
  ComputedValues,
  DashboardWidgetDto,
  FolderDto,
  GroupDto,
  ItemDto,
  ViewDto,
  WidgetType,
  WorkspaceDto,
} from './contracts/dto';

const iso = (value: Date): string => value.toISOString();
const isoOrNull = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function toWorkspaceDto(row: typeof workspaces.$inferSelect): WorkspaceDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    kind: row.kind,
    position: row.position,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toFolderDto(row: typeof folders.$inferSelect): FolderDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    parentId: row.parentId,
    name: row.name,
    color: row.color,
    position: row.position,
  };
}

export function toBoardSummaryDto(row: typeof boards.$inferSelect): BoardSummaryDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    folderId: row.folderId,
    name: row.name,
    kind: row.kind,
    description: row.description,
    icon: row.icon,
    privacy: row.privacy,
    itemTerminology: row.itemTerminology,
    position: row.position,
    archivedAt: isoOrNull(row.archivedAt),
    deletedAt: isoOrNull(row.deletedAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toColumnDto(row: typeof columns.$inferSelect): ColumnDto {
  return {
    id: row.id,
    boardId: row.boardId,
    key: row.key,
    title: row.title,
    description: row.description,
    type: row.type,
    scope: row.scope,
    settings: row.settings,
    width: row.width,
    position: row.position,
    hidden: row.hidden,
    required: row.required,
  };
}

export function toGroupDto(row: typeof groups.$inferSelect): GroupDto {
  return {
    id: row.id,
    boardId: row.boardId,
    title: row.title,
    color: row.color,
    position: row.position,
    collapsedDefault: row.collapsedDefault,
    archivedAt: isoOrNull(row.archivedAt),
  };
}

export function toViewDto(row: typeof views.$inferSelect): ViewDto {
  return {
    id: row.id,
    boardId: row.boardId,
    type: row.type,
    name: row.name,
    config: row.config as Record<string, unknown>,
    position: row.position,
    isDefault: row.isDefault,
    ownerId: row.ownerId,
  };
}

export function toItemDto(
  row: typeof items.$inferSelect,
  extra: { computed?: ComputedValues; subitemCount?: number; updateCount?: number } = {},
): ItemDto {
  return {
    id: row.id,
    boardId: row.boardId,
    groupId: row.groupId,
    parentItemId: row.parentItemId,
    name: row.name,
    position: row.position,
    values: row.values,
    computed: extra.computed ?? {},
    subitemCount: extra.subitemCount ?? 0,
    updateCount: extra.updateCount ?? 0,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    archivedAt: isoOrNull(row.archivedAt),
    deletedAt: isoOrNull(row.deletedAt),
  };
}

export function toWidgetDto(row: typeof dashboardWidgets.$inferSelect): DashboardWidgetDto {
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    type: row.type as WidgetType,
    title: row.title,
    config: row.config,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
  };
}
