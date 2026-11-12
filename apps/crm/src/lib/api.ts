/**
 * Typed client for `/api/v1`. Unwraps the envelope: resolves with `data` (or `{ data, meta }`
 * via `apiRequestWithMeta`), rejects with `ApiClientError` carrying the server error code.
 *
 * `createApi(orgId)` returns a typed endpoint catalog bound to an organization; TanStack
 * Query hooks in `src/lib/hooks` are built on it.
 */
import type { ApiEnvelope, ApiMeta } from '@/server/http/envelope';
import { ORG_HEADER } from '@/server/http/envelope';
import type { ErrorCode } from '@/server/http/errors';
import type {
  ActivityDto,
  AuditLogDto,
  AutomationDto,
  AutomationRunDto,
  BoardDto,
  BoardPayloadDto,
  BoardSummaryDto,
  BoardTemplateDto,
  ColumnDto,
  DashboardDto,
  DashboardWidgetDto,
  EntityType,
  FavoriteDto,
  FileDto,
  FolderDto,
  GroupDto,
  InvitationDto,
  ItemDetailDto,
  ItemDto,
  LinkedItemDto,
  MeDto,
  MemberDto,
  NotificationDto,
  OnboardingResultDto,
  RecentVisitDto,
  SearchResultDto,
  TeamDto,
  UpdateDto,
  ViewDto,
  WidgetDataDto,
  WorkspaceDto,
  WorkspaceTreeDto,
} from '@/server/services/contracts/dto';
import type {
  BulkCreateItemsInput,
  BulkItemsInput,
  CreateItemInput,
  CreateUpdateInput,
  DuplicateItemInput,
  EditUpdateInput,
  ListItemsQuery,
  MoveItemInput,
  UpdateItemInput,
} from '@/server/services/contracts/item-inputs';
import type {
  BoardMembersInput,
  CreateBoardInput,
  CreateColumnInput,
  CreateFolderInput,
  CreateGroupInput,
  CreateViewInput,
  CreateWorkspaceInput,
  DuplicateBoardInput,
  ListBoardsQuery,
  UpdateBoardInput,
  UpdateColumnInput,
  UpdateFolderInput,
  UpdateGroupInput,
  UpdateViewInput,
  UpdateWorkspaceInput,
} from '@/server/services/contracts/structure-inputs';
import type { CreateAutomationInput, UpdateAutomationInput } from '@/server/automations-engine/recipes';
import type { OrgRole } from '@/server/rbac/permissions';

export class ApiClientError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE';
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiClientError['code'], message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface ApiRequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  readonly query?: Readonly<Record<string, string | number | boolean | null | undefined | readonly string[]>>;
  /** Organization id sent as `x-org-id`. */
  readonly orgId?: string;
  readonly signal?: AbortSignal;
  /** Let the request outlive the page (fire-and-forget writes on tab close). */
  readonly keepalive?: boolean;
}

export function buildApiUrl(path: string, query?: ApiRequestOptions['query']): string {
  const url = `/api/v1${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const entry of value) params.append(key, String(entry));
    else params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function parseEnvelope<T>(response: Response): Promise<{ data: T; meta?: ApiMeta }> {
  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiClientError('INVALID_RESPONSE', 'Unexpected response from the server.', response.status);
  }
  if (!envelope.ok) {
    throw new ApiClientError(
      envelope.error.code,
      envelope.error.message,
      response.status,
      envelope.error.details,
    );
  }
  return envelope.meta ? { data: envelope.data, meta: envelope.meta } : { data: envelope.data };
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { credentials: 'same-origin', ...init });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiClientError('NETWORK_ERROR', 'Network error. Check your connection and try again.', 0);
  }
}

export async function apiRequestWithMeta<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<{ data: T; meta?: ApiMeta }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.orgId) headers[ORG_HEADER] = options.orgId;
  const response = await send(buildApiUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    ...(options.keepalive ? { keepalive: true } : {}),
  });
  return parseEnvelope<T>(response);
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return (await apiRequestWithMeta<T>(path, options)).data;
}

/** multipart/form-data upload (the browser sets the boundary). */
export async function apiUpload<T>(
  path: string,
  form: FormData,
  options: { orgId?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.orgId) headers[ORG_HEADER] = options.orgId;
  const response = await send(buildApiUrl(path), {
    method: 'POST',
    headers,
    body: form,
    signal: options.signal,
  });
  return (await parseEnvelope<T>(response)).data;
}

export interface Paginated<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
  readonly meta?: ApiMeta;
}

async function paginated<T>(path: string, options: ApiRequestOptions): Promise<Paginated<T>> {
  const { data, meta } = await apiRequestWithMeta<T[]>(path, options);
  return { items: data, nextCursor: (meta?.nextCursor as string | null | undefined) ?? null, meta };
}

export interface CursorParams {
  readonly cursor?: string;
  readonly limit?: number;
}

type Q = ApiRequestOptions['query'];

/** Typed endpoint catalog bound to an organization. */
export function createApi(orgId: string) {
  const get = <T>(path: string, query?: Q, signal?: AbortSignal) =>
    apiRequest<T>(path, { orgId, query, signal });
  const write = <T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
    apiRequest<T>(path, { orgId, method, body });
  const page = <T>(path: string, query?: Q, signal?: AbortSignal) =>
    paginated<T>(path, { orgId, query, signal });

  return {
    orgId,
    workspaces: {
      list: (signal?: AbortSignal) => get<WorkspaceDto[]>('/workspaces', undefined, signal),
      get: (id: string) => get<WorkspaceDto>(`/workspaces/${id}`),
      tree: (id: string, signal?: AbortSignal) =>
        get<WorkspaceTreeDto>(`/workspaces/${id}/tree`, undefined, signal),
      create: (input: Partial<CreateWorkspaceInput> & { name: string }) =>
        write<WorkspaceDto>('POST', '/workspaces', input),
      update: (id: string, input: UpdateWorkspaceInput) =>
        write<WorkspaceDto>('PATCH', `/workspaces/${id}`, input),
      remove: (id: string) => write<{ id: string }>('DELETE', `/workspaces/${id}`),
      setMembers: (id: string, userIds: string[]) =>
        write<{ userIds: string[] }>('PUT', `/workspaces/${id}/members`, { userIds }),
    },
    folders: {
      create: (input: CreateFolderInput) => write<FolderDto>('POST', '/folders', input),
      update: (id: string, input: UpdateFolderInput) => write<FolderDto>('PATCH', `/folders/${id}`, input),
      remove: (id: string) => write<{ id: string }>('DELETE', `/folders/${id}`),
    },
    boards: {
      list: (query: Partial<ListBoardsQuery> = {}, signal?: AbortSignal) =>
        get<BoardSummaryDto[]>('/boards', query, signal),
      templates: () => get<BoardTemplateDto[]>('/boards/templates'),
      get: (id: string) => get<BoardDto>(`/boards/${id}`),
      full: (id: string, query: CursorParams = {}, signal?: AbortSignal) =>
        get<BoardPayloadDto>(`/boards/${id}/full`, { ...query }, signal),
      create: (input: Partial<CreateBoardInput> & { workspaceId: string; name: string }) =>
        write<BoardDto>('POST', '/boards', input),
      update: (id: string, input: UpdateBoardInput) => write<BoardDto>('PATCH', `/boards/${id}`, input),
      remove: (id: string) => write<BoardSummaryDto>('DELETE', `/boards/${id}`),
      lifecycle: (id: string, action: 'archive' | 'unarchive' | 'restore') =>
        write<BoardSummaryDto>('POST', `/boards/${id}/lifecycle`, { action }),
      duplicate: (id: string, input: Partial<DuplicateBoardInput> = {}) =>
        write<BoardDto>('POST', `/boards/${id}/duplicate`, input),
      setMembers: (id: string, input: BoardMembersInput) =>
        write<BoardDto>('PUT', `/boards/${id}/members`, input),
      activity: (id: string, query: CursorParams = {}) =>
        page<ActivityDto>(`/boards/${id}/activity`, { ...query }),
      files: (id: string) => get<FileDto[]>(`/boards/${id}/files`),
    },
    columns: {
      list: (boardId: string) => get<ColumnDto[]>(`/boards/${boardId}/columns`),
      create: (
        boardId: string,
        input: Partial<CreateColumnInput> & Pick<CreateColumnInput, 'title' | 'type'>,
      ) => write<ColumnDto>('POST', `/boards/${boardId}/columns`, input),
      update: (boardId: string, columnId: string, input: UpdateColumnInput) =>
        write<ColumnDto>('PATCH', `/boards/${boardId}/columns/${columnId}`, input),
      remove: (boardId: string, columnId: string) =>
        write<{ id: string }>('DELETE', `/boards/${boardId}/columns/${columnId}`),
      restore: (boardId: string, columnId: string) =>
        write<ColumnDto>('POST', `/boards/${boardId}/columns/${columnId}/restore`),
    },
    groups: {
      list: (boardId: string, includeArchived = false) =>
        get<GroupDto[]>(`/boards/${boardId}/groups`, { includeArchived: String(includeArchived) }),
      create: (boardId: string, input: CreateGroupInput) =>
        write<GroupDto>('POST', `/boards/${boardId}/groups`, input),
      update: (boardId: string, groupId: string, input: UpdateGroupInput) =>
        write<GroupDto>('PATCH', `/boards/${boardId}/groups/${groupId}`, input),
      remove: (boardId: string, groupId: string) =>
        write<{ id: string }>('DELETE', `/boards/${boardId}/groups/${groupId}`),
      duplicate: (boardId: string, groupId: string) =>
        write<GroupDto>('POST', `/boards/${boardId}/groups/${groupId}/duplicate`),
      archive: (boardId: string, groupId: string, archived: boolean) =>
        write<GroupDto>('POST', `/boards/${boardId}/groups/${groupId}/archive`, { archived }),
    },
    views: {
      list: (boardId: string) => get<ViewDto[]>(`/boards/${boardId}/views`),
      create: (boardId: string, input: Partial<CreateViewInput> & Pick<CreateViewInput, 'type' | 'name'>) =>
        write<ViewDto>('POST', `/boards/${boardId}/views`, input),
      update: (viewId: string, input: Partial<UpdateViewInput>) =>
        write<ViewDto>('PATCH', `/views/${viewId}`, input),
      remove: (viewId: string) => write<{ id: string }>('DELETE', `/views/${viewId}`),
    },
    items: {
      list: (boardId: string, query: Partial<ListItemsQuery> = {}, signal?: AbortSignal) =>
        page<ItemDto>(`/boards/${boardId}/items`, { ...query }, signal),
      detail: (itemId: string, signal?: AbortSignal) =>
        get<ItemDetailDto>(`/items/${itemId}`, undefined, signal),
      create: (boardId: string, input: CreateItemInput) =>
        write<ItemDto>('POST', `/boards/${boardId}/items`, input),
      bulkCreate: (boardId: string, input: BulkCreateItemsInput) =>
        write<ItemDto[]>('POST', `/boards/${boardId}/items/bulk`, input),
      update: (itemId: string, input: UpdateItemInput) => write<ItemDto>('PATCH', `/items/${itemId}`, input),
      setCell: (itemId: string, columnKey: string, value: unknown) =>
        write<ItemDto>('PUT', `/items/${itemId}/values`, { columnKey, value }),
      move: (itemId: string, input: MoveItemInput) => write<ItemDto>('POST', `/items/${itemId}/move`, input),
      duplicate: (itemId: string, input: Partial<DuplicateItemInput> = {}) =>
        write<ItemDto>('POST', `/items/${itemId}/duplicate`, input),
      lifecycle: (itemId: string, action: 'archive' | 'restore') =>
        write<{ id: string }>('POST', `/items/${itemId}/lifecycle`, { action }),
      remove: (itemId: string) => write<{ id: string }>('DELETE', `/items/${itemId}`),
      bulk: (input: BulkItemsInput) =>
        write<{ action: string; itemIds: string[]; items?: ItemDto[] }>('POST', '/items/bulk', input),
      subitems: (itemId: string) => get<ItemDto[]>(`/items/${itemId}/subitems`),
      createSubitem: (itemId: string, input: Omit<CreateItemInput, 'parentItemId'>) =>
        write<ItemDto>('POST', `/items/${itemId}/subitems`, input),
      links: (itemId: string) => get<LinkedItemDto[]>(`/items/${itemId}/links`),
      activity: (itemId: string, query: CursorParams = {}) =>
        page<ActivityDto>(`/items/${itemId}/activity`, { ...query }),
      files: (itemId: string) => get<FileDto[]>(`/items/${itemId}/files`),
      upload: (itemId: string, file: File, extra: { updateId?: string; columnKey?: string } = {}) => {
        const form = new FormData();
        form.set('file', file);
        if (extra.updateId) form.set('updateId', extra.updateId);
        if (extra.columnKey) form.set('columnKey', extra.columnKey);
        return apiUpload<FileDto>(`/items/${itemId}/files`, form, { orgId });
      },
    },
    updates: {
      list: (itemId: string) => get<UpdateDto[]>(`/items/${itemId}/updates`),
      create: (itemId: string, input: CreateUpdateInput) =>
        write<UpdateDto>('POST', `/items/${itemId}/updates`, input),
      edit: (updateId: string, input: EditUpdateInput) =>
        write<UpdateDto>('PATCH', `/updates/${updateId}`, input),
      remove: (updateId: string) => write<{ id: string }>('DELETE', `/updates/${updateId}`),
      pin: (updateId: string, pinned: boolean) =>
        write<UpdateDto>('POST', `/updates/${updateId}/pin`, { pinned }),
      react: (updateId: string, emoji: string) =>
        write<UpdateDto>('POST', `/updates/${updateId}/reactions`, { emoji }),
      markItemRead: (itemId: string) => write<{ marked: number }>('POST', `/items/${itemId}/updates/read`),
    },
    files: {
      url: (fileId: string, download = false) =>
        buildApiUrl(`/files/${fileId}`, download ? { download: '1' } : undefined),
      remove: (fileId: string) => write<{ id: string }>('DELETE', `/files/${fileId}`),
    },
    dashboards: {
      list: (workspaceId?: string) => get<DashboardDto[]>('/dashboards', { workspaceId }),
      get: (id: string) => get<DashboardDto>(`/dashboards/${id}`),
      create: (input: {
        name: string;
        description?: string | null;
        workspaceId?: string | null;
        boardIds?: string[];
      }) => write<DashboardDto>('POST', '/dashboards', input),
      update: (id: string, input: { name?: string; description?: string | null; boardIds?: string[] }) =>
        write<DashboardDto>('PATCH', `/dashboards/${id}`, input),
      remove: (id: string) => write<{ id: string }>('DELETE', `/dashboards/${id}`),
      addWidget: (id: string, input: Omit<DashboardWidgetDto, 'id' | 'dashboardId'>) =>
        write<DashboardWidgetDto>('POST', `/dashboards/${id}/widgets`, input),
      updateWidget: (
        widgetId: string,
        input: Partial<Omit<DashboardWidgetDto, 'id' | 'dashboardId' | 'type'>>,
      ) => write<DashboardWidgetDto>('PATCH', `/widgets/${widgetId}`, input),
      removeWidget: (widgetId: string) => write<{ id: string }>('DELETE', `/widgets/${widgetId}`),
      widgetData: (widgetId: string, signal?: AbortSignal) =>
        get<WidgetDataDto>(`/widgets/${widgetId}/data`, undefined, signal),
    },
    automations: {
      list: (boardId: string) => get<AutomationDto[]>(`/boards/${boardId}/automations`),
      get: (id: string) => get<AutomationDto>(`/automations/${id}`),
      create: (boardId: string, input: CreateAutomationInput) =>
        write<AutomationDto>('POST', `/boards/${boardId}/automations`, input),
      update: (id: string, input: UpdateAutomationInput) =>
        write<AutomationDto>('PATCH', `/automations/${id}`, input),
      remove: (id: string) => write<{ id: string }>('DELETE', `/automations/${id}`),
      runs: (id: string, query: CursorParams = {}) =>
        page<AutomationRunDto>(`/automations/${id}/runs`, { ...query }),
      scan: (date?: string) =>
        write<{ date: string; automationsScanned: number }>(
          'POST',
          '/automations/scan',
          date ? { date } : {},
        ),
    },
    notifications: {
      list: (
        query: CursorParams & { filter?: 'all' | 'unread' | 'mentions' | 'assigned' } = {},
        signal?: AbortSignal,
      ) => page<NotificationDto>('/notifications', { ...query }, signal),
      unreadCount: () => get<{ unreadCount: number }>('/notifications/unread-count'),
      mark: (input: { ids?: string[]; all?: boolean; read?: boolean }) =>
        write<{ updated: number; unreadCount: number }>('POST', '/notifications/read', input),
    },
    favorites: {
      list: () => get<FavoriteDto[]>('/favorites'),
      add: (entityType: EntityType, entityId: string) =>
        write<FavoriteDto[]>('POST', '/favorites', { entityType, entityId }),
      remove: (entityType: EntityType, entityId: string) =>
        write<FavoriteDto[]>('DELETE', '/favorites', { entityType, entityId }),
      reorder: (favoriteId: string, placement: { afterId?: string | null; beforeId?: string | null }) =>
        write<FavoriteDto[]>('PATCH', '/favorites', { favoriteId, ...placement }),
    },
    recents: {
      list: (limit = 20) => get<RecentVisitDto[]>('/recents', { limit }),
      record: (entityType: EntityType, entityId: string) =>
        write<{ ok: true }>('POST', '/recents', { entityType, entityId }),
    },
    search: (
      q: string,
      options: { types?: string[]; boardId?: string; limit?: number } = {},
      signal?: AbortSignal,
    ) =>
      get<SearchResultDto[]>(
        '/search',
        { q, types: options.types?.join(','), boardId: options.boardId, limit: options.limit },
        signal,
      ),
    members: {
      list: () => get<MemberDto[]>('/members'),
      updateRole: (memberId: string, role: OrgRole) =>
        write<MemberDto>('PATCH', `/members/${memberId}`, { role }),
      remove: (memberId: string) => write<{ id: string }>('DELETE', `/members/${memberId}`),
    },
    invitations: {
      list: () => get<InvitationDto[]>('/invitations'),
      create: (input: { email: string; role?: OrgRole; teamId?: string }) =>
        write<InvitationDto>('POST', '/invitations', input),
      revoke: (id: string) => write<{ id: string }>('DELETE', `/invitations/${id}`),
    },
    teams: {
      list: () => get<TeamDto[]>('/teams'),
      create: (name: string) => write<TeamDto>('POST', '/teams', { name }),
      rename: (id: string, name: string) => write<TeamDto>('PATCH', `/teams/${id}`, { name }),
      remove: (id: string) => write<{ id: string }>('DELETE', `/teams/${id}`),
      addMembers: (id: string, userIds: string[]) =>
        write<TeamDto>('POST', `/teams/${id}/members`, { userIds }),
      removeMembers: (id: string, userIds: string[]) =>
        write<TeamDto>('DELETE', `/teams/${id}/members`, { userIds }),
    },
    auditLog: (query: CursorParams & { action?: string; actorId?: string } = {}) =>
      page<AuditLogDto>('/audit-log', { ...query }),
    /** EventSource URL (org id in the path because EventSource cannot send headers). */
    streamUrl: (boardId?: string) => buildApiUrl(`/orgs/${orgId}/stream`, boardId ? { boardId } : undefined),
  };
}

export type KitstakApi = ReturnType<typeof createApi>;

/** Org-independent endpoints. */
export const accountApi = {
  me: (signal?: AbortSignal) => apiRequest<MeDto>('/me', { signal }),
  onboard: (input: {
    organizationName: string;
    slug?: string;
    workspaceName?: string;
    templateIds?: string[];
    withSampleData?: boolean;
    teamSize?: '1' | '2-5' | '6-20' | '21-100' | '101-500' | '500+';
    useCase?: string;
  }) => apiRequest<OnboardingResultDto>('/onboarding', { method: 'POST', body: input }),
};
