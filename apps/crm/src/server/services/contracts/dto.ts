/**
 * API response shapes (DTOs). TYPES ONLY — safe to `import type` from client code.
 * Dates are ISO-8601 strings on the wire.
 */
import type { ColumnScopeName, ColumnSettings, ColumnType, ItemValues } from './shared';
import type { OrgRole } from '@/server/rbac/permissions';

export type BoardKind = 'leads' | 'contacts' | 'accounts' | 'deals' | 'activities' | 'projects' | 'custom';
export type BoardPrivacy = 'main' | 'private' | 'shareable';
export type BoardRole = 'owner' | 'editor' | 'viewer' | 'subscriber';
export type ViewType =
  'table' | 'kanban' | 'calendar' | 'timeline' | 'chart' | 'form' | 'dashboard' | 'files';
export type WidgetType =
  | 'number'
  | 'chart'
  | 'battery'
  | 'table'
  | 'calendar'
  | 'timeline'
  | 'workload'
  | 'leaderboard'
  | 'funnel'
  | 'text';
export type EntityType = 'workspace' | 'folder' | 'board' | 'dashboard' | 'item' | 'view';
export type NotificationKind =
  | 'mention'
  | 'assigned'
  | 'update_reply'
  | 'update_on_subscribed'
  | 'status_change'
  | 'due_date'
  | 'invitation'
  | 'automation'
  | 'reaction'
  | 'board_shared';

export interface UserSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
  readonly title: string | null;
}

export interface WorkspaceDto {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly icon: string | null;
  readonly color: string;
  readonly kind: 'open' | 'closed';
  readonly position: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FolderDto {
  readonly id: string;
  readonly workspaceId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly color: string | null;
  readonly position: string;
}

export interface BoardSummaryDto {
  readonly id: string;
  readonly workspaceId: string;
  readonly folderId: string | null;
  readonly name: string;
  readonly kind: BoardKind;
  readonly description: string | null;
  readonly icon: string | null;
  readonly privacy: BoardPrivacy;
  readonly itemTerminology: string;
  readonly position: string;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly updatedAt: string;
}

export interface BoardMemberDto {
  readonly userId: string;
  readonly role: BoardRole;
}

export interface BoardDto extends BoardSummaryDto {
  readonly settings: Record<string, unknown>;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly members: readonly BoardMemberDto[];
  /** Caller's effective capability on this board. */
  readonly canEdit: boolean;
}

export interface DashboardSummaryDto {
  readonly id: string;
  readonly workspaceId: string | null;
  readonly name: string;
  readonly position: string;
}

/** Sidebar tree for one workspace. */
export interface WorkspaceTreeDto {
  readonly workspace: WorkspaceDto;
  readonly folders: readonly FolderDto[];
  readonly boards: readonly BoardSummaryDto[];
  readonly dashboards: readonly DashboardSummaryDto[];
}

export interface ColumnDto {
  readonly id: string;
  readonly boardId: string;
  readonly key: string;
  readonly title: string;
  readonly description: string | null;
  readonly type: ColumnType;
  readonly scope: ColumnScopeName;
  readonly settings: ColumnSettings;
  readonly width: number;
  readonly position: string;
  readonly hidden: boolean;
  readonly required: boolean;
}

export interface GroupDto {
  readonly id: string;
  readonly boardId: string;
  readonly title: string;
  readonly color: string;
  readonly position: string;
  readonly collapsedDefault: boolean;
  readonly archivedAt: string | null;
}

/** Read-time values of computed columns, keyed by column key. */
export type ComputedValues = Record<string, unknown>;

export interface ItemDto {
  readonly id: string;
  readonly boardId: string;
  readonly groupId: string;
  readonly parentItemId: string | null;
  readonly name: string;
  readonly position: string;
  readonly values: ItemValues;
  readonly computed: ComputedValues;
  readonly subitemCount: number;
  readonly updateCount: number;
  readonly createdBy: string | null;
  readonly updatedBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
}

export interface ViewDto {
  readonly id: string;
  readonly boardId: string;
  readonly type: ViewType;
  readonly name: string;
  readonly config: Record<string, unknown>;
  readonly position: string;
  readonly isDefault: boolean;
  readonly ownerId: string | null;
}

/** First-paint payload for a board page. */
export interface BoardPayloadDto {
  readonly board: BoardDto;
  readonly columns: readonly ColumnDto[];
  readonly groups: readonly GroupDto[];
  readonly views: readonly ViewDto[];
  readonly items: readonly ItemDto[];
  readonly nextCursor: string | null;
  readonly totalItems: number;
  /** Users referenced by the payload (people columns, owners) and all org members. */
  readonly users: readonly UserSummaryDto[];
}

/** Item with its board context for the item side panel. */
export interface ItemDetailDto {
  readonly item: ItemDto;
  readonly board: BoardSummaryDto;
  readonly columns: readonly ColumnDto[];
  readonly group: GroupDto | null;
  readonly subitems: readonly ItemDto[];
  /** Connected items (both directions) with their board names for connect_boards cells. */
  readonly linkedItems: readonly LinkedItemDto[];
}

export interface LinkedItemDto {
  readonly id: string;
  readonly name: string;
  readonly boardId: string;
  readonly boardName: string;
  readonly columnKey: string;
  readonly direction: 'outgoing' | 'incoming';
}

export interface ReactionDto {
  readonly emoji: string;
  readonly count: number;
  readonly userIds: readonly string[];
  readonly reactedByMe: boolean;
}

export interface FileDto {
  readonly id: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly boardId: string | null;
  readonly itemId: string | null;
  readonly updateId: string | null;
  readonly columnKey: string | null;
  readonly uploadedBy: string | null;
  readonly createdAt: string;
  /** Authenticated download URL. */
  readonly url: string;
}

export interface UpdateDto {
  readonly id: string;
  readonly boardId: string;
  readonly itemId: string;
  readonly parentUpdateId: string | null;
  readonly author: UserSummaryDto | null;
  readonly body: { readonly type: 'doc'; readonly content?: readonly unknown[] };
  readonly bodyText: string;
  readonly mentionedUserIds: readonly string[];
  readonly pinned: boolean;
  readonly editedAt: string | null;
  readonly createdAt: string;
  readonly reactions: readonly ReactionDto[];
  readonly readByMe: boolean;
  readonly readCount: number;
  readonly files: readonly FileDto[];
  readonly replies: readonly UpdateDto[];
}

export interface ActivityDto {
  readonly id: string;
  readonly boardId: string | null;
  readonly itemId: string | null;
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly actorImage: string | null;
  readonly automationId: string | null;
  readonly action: string;
  readonly columnKey: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly createdAt: string;
}

export interface DashboardWidgetDto {
  readonly id: string;
  readonly dashboardId: string;
  readonly type: WidgetType;
  readonly title: string;
  readonly config: Record<string, unknown>;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface DashboardDto extends DashboardSummaryDto {
  readonly description: string | null;
  /** Creator (owner) of the dashboard; null for system-created rows. */
  readonly createdBy?: string | null;
  readonly config: Record<string, unknown>;
  readonly widgets: readonly DashboardWidgetDto[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WidgetDataPoint {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly color?: string;
  readonly count?: number;
}

export interface WidgetDataDto {
  readonly widgetId: string;
  readonly type: WidgetType;
  readonly total: number;
  readonly series: readonly WidgetDataPoint[];
  readonly itemCount: number;
  readonly rows?: readonly ItemDto[];
}

export interface AutomationDto {
  readonly id: string;
  readonly boardId: string;
  readonly name: string;
  readonly description: string | null;
  readonly trigger: { readonly type: string; readonly config?: Record<string, unknown> };
  readonly conditions: readonly { readonly type: string; readonly config?: Record<string, unknown> }[];
  readonly actions: readonly { readonly type: string; readonly config?: Record<string, unknown> }[];
  readonly enabled: boolean;
  readonly runCount: number;
  readonly failureCount: number;
  readonly lastRunAt: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AutomationRunDto {
  readonly id: string;
  readonly automationId: string;
  readonly itemId: string | null;
  readonly status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  readonly triggerEvent: Record<string, unknown>;
  readonly result: Record<string, unknown> | null;
  readonly error: string | null;
  readonly durationMs: number | null;
  readonly createdAt: string;
}

export interface NotificationDto {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly actor: UserSummaryDto | null;
  readonly boardId: string | null;
  readonly boardName: string | null;
  readonly itemId: string | null;
  readonly itemName: string | null;
  readonly updateId: string | null;
  readonly payload: Record<string, unknown>;
  readonly readAt: string | null;
  readonly createdAt: string;
}

export interface FavoriteDto {
  readonly id: string;
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly name: string;
  readonly position: string;
  /** Board kind / icon to render the sidebar row. */
  readonly icon: string | null;
  readonly boardKind: BoardKind | null;
  /** Owning workspace (folder favorites link to the workspace overview). */
  readonly workspaceId?: string | null;
}

export interface RecentVisitDto {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly name: string;
  readonly workspaceId: string | null;
  readonly workspaceName: string | null;
  readonly visitedAt: string;
  readonly visitCount: number;
  /** Board kind for board visits (drives the kind icon); null otherwise. */
  readonly boardKind?: BoardKind | null;
}

export type SearchResultType = 'item' | 'board' | 'update' | 'workspace';

export interface SearchResultDto {
  readonly type: SearchResultType;
  readonly id: string;
  readonly title: string;
  readonly snippet: string | null;
  readonly boardId: string | null;
  readonly boardName: string | null;
  readonly itemId: string | null;
  readonly groupTitle: string | null;
  readonly rank: number;
  readonly updatedAt: string;
}

export interface MemberDto {
  readonly memberId: string;
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
  readonly title: string | null;
  readonly role: OrgRole;
  readonly teamIds: readonly string[];
  readonly joinedAt: string;
}

export interface InvitationDto {
  readonly id: string;
  readonly email: string;
  readonly role: OrgRole;
  readonly teamId: string | null;
  readonly status: string;
  readonly inviterId: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface TeamDto {
  readonly id: string;
  readonly name: string;
  readonly memberIds: readonly string[];
  readonly createdAt: string;
}

export interface AuditLogDto {
  readonly id: string;
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

export interface OnboardingResultDto {
  readonly organization: { readonly id: string; readonly name: string; readonly slug: string };
  readonly workspace: WorkspaceDto;
  readonly boards: readonly BoardSummaryDto[];
}

export interface MeDto {
  readonly user: UserSummaryDto & { readonly timezone: string | null };
  readonly organizations: readonly {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly logo: string | null;
    readonly role: OrgRole;
  }[];
  readonly unreadNotifications: number;
}

export interface BoardTemplateDto {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: BoardKind;
  readonly icon: string;
  readonly category: 'crm' | 'work' | 'blank';
  readonly columnCount: number;
}
