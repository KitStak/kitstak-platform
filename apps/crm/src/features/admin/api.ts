'use client';
/**
 * Admin / profile / trash data layer: typed calls to `/api/v1/admin/*`, `/profile`, `/trash`,
 * `/assets`, plus TanStack Query hooks with optimistic updates and rollback.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { apiRequest, apiRequestWithMeta, apiUpload, buildApiUrl, ApiClientError } from '@/lib/api';
import { toastError, useOrgId } from '@/lib/hooks';
import { queryKeys } from '@/lib/query-keys';
import { ORG_HEADER } from '@/server/http/envelope';
import type {
  AdminAuditEntryDto,
  AdminAuditQuery,
  AdminSessionDto,
  AdminUsersDto,
  ApiTokenDto,
  BulkResultDto,
  BulkUsersInput,
  CreateApiTokenInput,
  CreatedApiTokenDto,
  OrgAdminDto,
  OrgSettings,
  ProfileDto,
  TrashEntriesInput,
  TrashEntryDto,
  TrashResultDto,
  TrashType,
  UpdateOrgGeneralInput,
  UpdateOrgPolicyInput,
  UpdateProfileInput,
  UploadedAssetDto,
  UsageDto,
  AdminInvitationDto,
} from '@/server/services/admin-contracts';

export const adminKeys = {
  root: (orgId: string) => ['org', orgId, 'admin'] as const,
  org: (orgId: string) => ['org', orgId, 'admin', 'org'] as const,
  users: (orgId: string) => ['org', orgId, 'admin', 'users'] as const,
  sessions: (orgId: string) => ['org', orgId, 'admin', 'sessions'] as const,
  audit: (orgId: string, filters: Record<string, unknown>) => ['org', orgId, 'admin', 'audit', filters] as const,
  tokens: (orgId: string, scope: string) => ['org', orgId, 'admin', 'tokens', scope] as const,
  usage: (orgId: string) => ['org', orgId, 'admin', 'usage'] as const,
  profile: (orgId: string) => ['org', orgId, 'profile'] as const,
  trash: (orgId: string) => ['org', orgId, 'trash'] as const,
};

type Write = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

function call<T>(orgId: string, path: string, method?: Write, body?: unknown, query?: Record<string, string | number | undefined>) {
  return apiRequest<T>(path, { orgId, method, body, query });
}

// ---------------------------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------------------------

async function freeze<T>(queryClient: ReturnType<typeof useQueryClient>, key: QueryKey) {
  await queryClient.cancelQueries({ queryKey: key });
  return queryClient.getQueryData<T>(key);
}

// ---------------------------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------------------------

export function useOrgAdmin() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: adminKeys.org(orgId),
    queryFn: () => call<OrgAdminDto>(orgId, '/admin/org'),
    staleTime: 30_000,
  });
}

export function useUpdateOrgGeneral() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateOrgGeneralInput) => call<OrgAdminDto>(orgId, '/admin/org', 'PATCH', input),
    onSuccess: (data) => queryClient.setQueryData(adminKeys.org(orgId), data),
    onError: (error) => toastError(error, 'Could not save organization settings'),
  });
}

export function useUpdateOrgPolicy() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const key = adminKeys.org(orgId);
  return useMutation({
    mutationFn: (input: UpdateOrgPolicyInput) => call<OrgAdminDto>(orgId, '/admin/policy', 'PATCH', input),
    onMutate: async (input) => {
      const saved = await freeze<OrgAdminDto>(queryClient, key);
      if (saved) queryClient.setQueryData<OrgAdminDto>(key, { ...saved, settings: { ...saved.settings, ...input } as OrgSettings });
      return { saved };
    },
    onError: (error, _input, context) => {
      if (context?.saved) queryClient.setQueryData(key, context.saved);
      toastError(error, 'Could not save the policy');
    },
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
}

export function useSetTeamOwners() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const key = adminKeys.org(orgId);
  return useMutation({
    mutationFn: (vars: { teamId: string; userIds: string[] }) =>
      call<OrgSettings>(orgId, `/admin/teams/${vars.teamId}/owners`, 'PUT', { userIds: vars.userIds }),
    onMutate: async (vars) => {
      const saved = await freeze<OrgAdminDto>(queryClient, key);
      if (saved) {
        queryClient.setQueryData<OrgAdminDto>(key, {
          ...saved,
          settings: { ...saved.settings, teamOwners: { ...saved.settings.teamOwners, [vars.teamId]: vars.userIds } },
        });
      }
      return { saved };
    },
    onError: (error, _vars, context) => {
      if (context?.saved) queryClient.setQueryData(key, context.saved);
      toastError(error, 'Could not update team owners');
    },
    onSuccess: (settings) =>
      queryClient.setQueryData<OrgAdminDto>(key, (current) => (current ? { ...current, settings } : current)),
  });
}

// ---------------------------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------------------------

export function useAdminUsers() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: adminKeys.users(orgId),
    queryFn: () => call<AdminUsersDto>(orgId, '/admin/users'),
    staleTime: 15_000,
  });
}

export function useBulkUsers() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const key = adminKeys.users(orgId);
  return useMutation({
    mutationFn: (input: BulkUsersInput) => call<BulkResultDto>(orgId, '/admin/users/bulk', 'POST', input),
    onMutate: async (input) => {
      const saved = await freeze<AdminUsersDto>(queryClient, key);
      if (saved) {
        const ids = new Set(input.memberIds);
        queryClient.setQueryData<AdminUsersDto>(key, {
          ...saved,
          users: saved.users.map((entry) => {
            if (!ids.has(entry.memberId)) return entry;
            if (input.action === 'set_role' && input.role) return { ...entry, role: input.role };
            if (input.action === 'deactivate') return { ...entry, status: 'deactivated' };
            if (input.action === 'reactivate') return { ...entry, status: 'active' };
            return entry;
          }),
        });
      }
      return { saved };
    },
    onError: (error, _input, context) => {
      if (context?.saved) queryClient.setQueryData(key, context.saved);
      toastError(error, 'Could not update members');
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: queryKeys.members(orgId) }),
      ]),
  });
}

export function useResendInvitation() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) =>
      call<AdminInvitationDto>(orgId, `/admin/invitations/${invitationId}/resend`, 'POST'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.users(orgId) }),
    onError: (error) => toastError(error, 'Could not resend the invitation'),
  });
}

export function useRevokeInvitationOptimistic() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const key = adminKeys.users(orgId);
  return useMutation({
    mutationFn: (invitationId: string) => call<{ id: string }>(orgId, `/invitations/${invitationId}`, 'DELETE'),
    onMutate: async (invitationId) => {
      const saved = await freeze<AdminUsersDto>(queryClient, key);
      if (saved) {
        queryClient.setQueryData<AdminUsersDto>(key, {
          ...saved,
          invitations: saved.invitations.filter((entry) => entry.id !== invitationId),
        });
      }
      return { saved };
    },
    onError: (error, _id, context) => {
      if (context?.saved) queryClient.setQueryData(key, context.saved);
      toastError(error, 'Could not revoke the invitation');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.invitations(orgId) }),
  });
}

export function useInviteMembers() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { emails: string[]; role: string }) => {
      const results = await Promise.allSettled(
        vars.emails.map((email) => call<{ id: string }>(orgId, '/invitations', 'POST', { email, role: vars.role })),
      );
      return results.map((result, index) => ({
        email: vars.emails[index] as string,
        ok: result.status === 'fulfilled',
        reason: result.status === 'rejected' ? (result.reason instanceof ApiClientError ? result.reason.message : 'Failed') : null,
      }));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: adminKeys.users(orgId) }),
  });
}

// ---------------------------------------------------------------------------------------------
// Sessions, audit, tokens, usage
// ---------------------------------------------------------------------------------------------

export function useOrgSessions() {
  const orgId = useOrgId();
  return useQuery({ queryKey: adminKeys.sessions(orgId), queryFn: () => call<AdminSessionDto[]>(orgId, '/admin/sessions') });
}

export function useRevokeOrgSession() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const key = adminKeys.sessions(orgId);
  return useMutation({
    mutationFn: (sessionId: string) => call<{ id: string }>(orgId, `/admin/sessions/${sessionId}`, 'DELETE'),
    onMutate: async (sessionId) => {
      const saved = await freeze<AdminSessionDto[]>(queryClient, key);
      if (saved) queryClient.setQueryData(key, saved.filter((entry) => entry.id !== sessionId));
      return { saved };
    },
    onError: (error, _id, context) => {
      if (context?.saved) queryClient.setQueryData(key, context.saved);
      toastError(error, 'Could not sign out the session');
    },
  });
}

export type AuditFilters = Omit<AdminAuditQuery, 'cursor' | 'limit' | 'order'> & { readonly order?: AdminAuditQuery['order'] };

function compact(filters: AuditFilters): Record<string, string> {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== '')) as Record<
    string,
    string
  >;
}

export function useAdminAudit(filters: AuditFilters) {
  const orgId = useOrgId();
  const query = compact(filters);
  return useInfiniteQuery({
    queryKey: adminKeys.audit(orgId, query),
    queryFn: async ({ pageParam }) => {
      const { data, meta } = await apiRequestWithMeta<AdminAuditEntryDto[]>('/admin/audit', {
        orgId,
        query: { ...query, cursor: pageParam ?? undefined, limit: 50 },
      });
      return { items: data, nextCursor: (meta?.nextCursor as string | null | undefined) ?? null };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: (previous) => previous,
  });
}

/** Download a CSV export (sent with the org header, saved through a blob link). */
export async function downloadCsv(orgId: string, path: string, query: Record<string, string> = {}): Promise<void> {
  const response = await fetch(buildApiUrl(path, query), {
    credentials: 'same-origin',
    headers: { [ORG_HEADER]: orgId, Accept: 'text/csv' },
  });
  if (!response.ok) {
    let message = 'The export failed. Please try again.';
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    } catch {
      /* not json */
    }
    throw new ApiClientError('INTERNAL', message, response.status);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'export.csv';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function useApiTokens(scope: 'mine' | 'org') {
  const orgId = useOrgId();
  return useQuery({
    queryKey: adminKeys.tokens(orgId, scope),
    queryFn: () => call<ApiTokenDto[]>(orgId, '/admin/api-tokens', undefined, undefined, { scope }),
  });
}

export function useCreateApiToken() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiTokenInput) => call<CreatedApiTokenDto>(orgId, '/admin/api-tokens', 'POST', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org', orgId, 'admin', 'tokens'] }),
  });
}

export function useRevokeApiToken() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const prefix = ['org', orgId, 'admin', 'tokens'] as const;
  return useMutation({
    mutationFn: (tokenId: string) => call<ApiTokenDto>(orgId, `/admin/api-tokens/${tokenId}`, 'DELETE'),
    onMutate: async (tokenId) => {
      await queryClient.cancelQueries({ queryKey: prefix });
      const saved = queryClient.getQueriesData<ApiTokenDto[]>({ queryKey: prefix });
      queryClient.setQueriesData<ApiTokenDto[]>({ queryKey: prefix }, (list) =>
        list?.map((entry) =>
          entry.id === tokenId ? { ...entry, status: 'revoked', revokedAt: new Date().toISOString() } : entry,
        ),
      );
      return { saved };
    },
    onError: (error, _id, context) => {
      for (const [key, data] of context?.saved ?? []) queryClient.setQueryData(key, data);
      toastError(error, 'Could not revoke the token');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: prefix }),
  });
}

export function useUsage() {
  const orgId = useOrgId();
  return useQuery({ queryKey: adminKeys.usage(orgId), queryFn: () => call<UsageDto>(orgId, '/admin/usage') });
}

// ---------------------------------------------------------------------------------------------
// Profile + assets
// ---------------------------------------------------------------------------------------------

export function useProfile() {
  const orgId = useOrgId();
  return useQuery({ queryKey: adminKeys.profile(orgId), queryFn: () => call<ProfileDto>(orgId, '/profile') });
}

export function useUpdateProfile() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const key = adminKeys.profile(orgId);
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => call<ProfileDto>(orgId, '/profile', 'PATCH', input),
    onMutate: async (input) => {
      const saved = await freeze<ProfileDto>(queryClient, key);
      if (saved) {
        const { name, title, timezone, image, notifications, ...prefs } = input;
        const mergedNotifications = { ...saved.prefs.notifications };
        for (const [event, channels] of Object.entries(notifications ?? {})) {
          const base = mergedNotifications[event] ?? { inApp: true, email: false };
          mergedNotifications[event] = { ...base, ...channels };
        }
        queryClient.setQueryData<ProfileDto>(key, {
          ...saved,
          user: {
            ...saved.user,
            ...(name !== undefined ? { name } : {}),
            ...(title !== undefined ? { title } : {}),
            ...(timezone !== undefined ? { timezone } : {}),
            ...(image !== undefined ? { image } : {}),
          },
          prefs: { ...saved.prefs, ...prefs, notifications: mergedNotifications } as ProfileDto['prefs'],
        });
      }
      return { saved };
    },
    onError: (error, _input, context) => {
      if (context?.saved) queryClient.setQueryData(key, context.saved);
      toastError(error, 'Could not save your profile');
    },
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
}

export function uploadImage(file: File): Promise<UploadedAssetDto> {
  const form = new FormData();
  form.append('file', file);
  return apiUpload<UploadedAssetDto>('/assets', form);
}

// ---------------------------------------------------------------------------------------------
// Trash
// ---------------------------------------------------------------------------------------------

export function useTrash() {
  const orgId = useOrgId();
  return useQuery({ queryKey: adminKeys.trash(orgId), queryFn: () => call<TrashEntryDto[]>(orgId, '/trash') });
}

function invalidateBoards(queryClient: ReturnType<typeof useQueryClient>, orgId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['org', orgId, 'boards'] }),
    queryClient.invalidateQueries({ queryKey: ['org', orgId, 'workspaces'] }),
    queryClient.invalidateQueries({ queryKey: ['org', orgId, 'board'] }),
  ]);
}

export function useTrashAction(kind: 'restore' | 'purge') {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const key = adminKeys.trash(orgId);
  return useMutation({
    mutationFn: (input: TrashEntriesInput) => call<TrashResultDto>(orgId, `/trash/${kind}`, 'POST', input),
    onMutate: async (input) => {
      const saved = await freeze<TrashEntryDto[]>(queryClient, key);
      const ids = new Set(input.entries.map((entry) => `${entry.type}:${entry.id}`));
      if (saved) queryClient.setQueryData(key, saved.filter((entry) => !ids.has(`${entry.type}:${entry.id}`)));
      return { saved };
    },
    onSuccess: (result, _input, context) => {
      if (result.failed.length > 0 && context?.saved) {
        // Put back the rows the server refused.
        const failed = new Set(result.failed.map((entry) => `${entry.type}:${entry.id}`));
        queryClient.setQueryData<TrashEntryDto[]>(key, (list) => [
          ...(list ?? []),
          ...(context.saved ?? []).filter((entry) => failed.has(`${entry.type}:${entry.id}`)),
        ]);
      }
    },
    onError: (error, _input, context) => {
      if (context?.saved) queryClient.setQueryData(key, context.saved);
      toastError(error, kind === 'restore' ? 'Could not restore' : 'Could not delete permanently');
    },
    onSettled: () => Promise.all([queryClient.invalidateQueries({ queryKey: key }), invalidateBoards(queryClient, orgId)]),
  });
}

export type { TrashType };
