'use client';
/**
 * Wizards data layer. Endpoints (org-scoped, /api/v1):
 *   GET  /wizards/templates    → TemplateGalleryEntry[]   (template center)
 *   POST /wizards/solutions    → InstalledSolutionDto     (connected CRM suite)
 *   POST /wizards/invitations  → BulkInvitationResult[]   (invite many, partial success)
 *   POST /boards               → BoardSummaryDto          (create from a template)
 *   GET  /invitations · DELETE /invitations/:id · GET /teams
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { ApiClientError } from '@/lib/api';
import type {
  BoardSummaryDto,
  BoardPrivacy,
  BoardKind,
  FolderDto,
  InvitationDto,
  MemberDto,
  TeamDto,
  WorkspaceDto,
} from '@/server/services/contracts/dto';
import type { TemplateGalleryEntry } from '@/server/services/wizards-gallery';
import type { InstalledSolutionDto } from '@/server/services/wizards-solutions';
import type { BulkInvitationResult } from '@/server/services/wizards-invitations';
import { shellKeys, type CreateFolderInput, type CreateWorkspaceInput } from '@/features/shell/api';
import type { InviteRole } from './model/invites';

/**
 * Hook-level onError for wizard mutations: every wizard shows its own inline error banner, so
 * this opts out of the global "Couldn't save your change" toast in providers.tsx.
 */
const handledInline = (): void => {};

export const wizardKeys = {
  gallery: (orgId: string) => ['org', orgId, 'wizards', 'gallery'] as const,
};

export function useTemplateGallery(orgId: string, enabled = true) {
  return useQuery({
    queryKey: wizardKeys.gallery(orgId),
    queryFn: ({ signal }) => apiRequest<TemplateGalleryEntry[]>('/wizards/templates', { orgId, signal }),
    staleTime: Number.POSITIVE_INFINITY,
    enabled,
  });
}

export interface CreateBoardFromTemplateInput {
  readonly workspaceId: string;
  readonly folderId: string | null;
  readonly name: string;
  readonly kind?: BoardKind;
  readonly privacy: BoardPrivacy;
  readonly itemTerminology: string;
  readonly templateId: string;
  readonly withSampleData: boolean;
}

export function useCreateBoardFromTemplate(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBoardFromTemplateInput) =>
      apiRequest<BoardSummaryDto>('/boards', { method: 'POST', orgId, body: input }),
    onError: handledInline,
    // Fire-and-forget refresh: returning the promise would hold the dialog open for a refetch.
    onSuccess: (board) => {
      void queryClient.invalidateQueries({ queryKey: shellKeys.workspaceTree(orgId, board.workspaceId) });
    },
  });
}

export function useInstallSolution(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { solutionId: string; workspaceName: string; withSampleData: boolean }) =>
      apiRequest<InstalledSolutionDto>('/wizards/solutions', { method: 'POST', orgId, body: input }),
    onError: handledInline,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shellKeys.workspaces(orgId) });
    },
  });
}

/** Create a workspace: the new row is written into the cached list at once, refetched in the background. */
export function useCreateWizardWorkspace(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkspaceInput) =>
      apiRequest<WorkspaceDto>('/workspaces', { method: 'POST', orgId, body: input }),
    onError: handledInline,
    onSuccess: (workspace) => {
      queryClient.setQueryData<WorkspaceDto[]>(shellKeys.workspaces(orgId), (list) =>
        list ? [...list.filter((row) => row.id !== workspace.id), workspace] : list,
      );
      void queryClient.invalidateQueries({ queryKey: shellKeys.workspaces(orgId) });
    },
  });
}

/** Create a folder without waiting for the tree refetch before the dialog closes. */
export function useCreateWizardFolder(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFolderInput) => apiRequest<FolderDto>('/folders', { method: 'POST', orgId, body: input }),
    onError: handledInline,
    onSuccess: (folder) => {
      void queryClient.invalidateQueries({ queryKey: shellKeys.workspaceTree(orgId, folder.workspaceId) });
    },
  });
}

/** Org members (for "Already a member" checks while typing invite emails). */
export function useMembersList(orgId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.members(orgId),
    queryFn: ({ signal }) => apiRequest<MemberDto[]>('/members', { orgId, signal }),
    enabled,
    staleTime: 60_000,
  });
}

export interface DescribedError {
  readonly message: string;
  /** False for permission / validation problems, where "Try again" cannot help. */
  readonly retryable: boolean;
}

export function describeError(cause: unknown): DescribedError {
  if (cause instanceof ApiClientError) {
    if (cause.code === 'NETWORK_ERROR') return { message: 'We couldn’t reach KitStak. Check your connection.', retryable: true };
    return { message: cause.message, retryable: cause.status >= 500 || cause.status === 429 };
  }
  return { message: 'Something went wrong. Please try again.', retryable: true };
}

export function useInvitationsList(orgId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.invitations(orgId),
    queryFn: ({ signal }) => apiRequest<InvitationDto[]>('/invitations', { orgId, signal }),
    enabled,
    staleTime: 15_000,
  });
}

export function useTeamsList(orgId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.teams(orgId),
    queryFn: ({ signal }) => apiRequest<TeamDto[]>('/teams', { orgId, signal }),
    enabled,
    staleTime: 60_000,
  });
}

export interface BulkInviteInput {
  readonly invitations: readonly { email: string; role: InviteRole; teamId?: string }[];
}

/** POST many invitations; the caller gets per-email results. Org id may differ from the shell's (onboarding). */
export function sendInvitations(orgId: string, input: BulkInviteInput): Promise<BulkInvitationResult[]> {
  return apiRequest<BulkInvitationResult[]>('/wizards/invitations', { method: 'POST', orgId, body: input });
}

export function useBulkInvite(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkInviteInput) => sendInvitations(orgId, input),
    onError: handledInline,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invitations(orgId) });
    },
  });
}

/** Revoke with an optimistic removal from the pending list; rolls back on failure. */
export function useRevokeInvite(orgId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.invitations(orgId);
  return useMutation({
    mutationFn: (invitationId: string) =>
      apiRequest<{ id: string }>(`/invitations/${invitationId}`, { method: 'DELETE', orgId }),
    onMutate: async (invitationId) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<InvitationDto[]>(key);
      queryClient.setQueryData<InvitationDto[]>(key, (list = []) => list.filter((row) => row.id !== invitationId));
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
