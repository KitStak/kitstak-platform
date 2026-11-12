'use client';

/** Members, invitations, teams, audit log, dashboards and automations. */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { CreateAutomationInput, UpdateAutomationInput } from '@/server/automations-engine/recipes';
import type {
  AuditLogDto,
  AutomationDto,
  AutomationRunDto,
  DashboardWidgetDto,
  MemberDto,
} from '@/server/services/contracts/dto';
import type { OrgRole } from '@/server/rbac/permissions';
import { restore, snapshot, toastError } from './cache';
import { useApi, useOrgId } from './org-context';

// Members & invitations ---------------------------------------------------------------------------

export function useMembers() {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: queryKeys.members(orgId),
    queryFn: () => api.members.list(),
    staleTime: 60_000,
  });
}

export function useUpdateMemberRole() {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { memberId: string; role: OrgRole }) =>
      api.members.updateRole(vars.memberId, vars.role),
    onMutate: async (vars) => {
      const saved = await snapshot(queryClient, queryKeys.members(orgId));
      queryClient.setQueryData<MemberDto[]>(queryKeys.members(orgId), (list) =>
        list?.map((entry) => (entry.memberId === vars.memberId ? { ...entry, role: vars.role } : entry)),
      );
      return { saved };
    },
    onError: (error, _vars, context) => {
      restore(queryClient, context?.saved);
      toastError(error, 'Could not change the role');
    },
  });
}

export function useRemoveMember() {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => api.members.remove(memberId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.members(orgId) }),
    onError: (error) => toastError(error, 'Could not remove the member'),
  });
}

export function useInvitations() {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({ queryKey: queryKeys.invitations(orgId), queryFn: () => api.invitations.list() });
}

export function useInvite() {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role?: OrgRole; teamId?: string }) => api.invitations.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.invitations(orgId) }),
    onError: (error) => toastError(error, 'Could not send the invitation'),
  });
}

export function useRevokeInvitation() {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) => api.invitations.revoke(invitationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.invitations(orgId) }),
    onError: (error) => toastError(error, 'Could not revoke the invitation'),
  });
}

// Teams ---------------------------------------------------------------------------------------------

export function useTeams() {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({ queryKey: queryKeys.teams(orgId), queryFn: () => api.teams.list() });
}

export function useTeamMutations() {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.teams(orgId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.members(orgId) }),
    ]);
  const onError = (title: string) => (error: unknown) => toastError(error, title);
  return {
    create: useMutation({
      mutationFn: (name: string) => api.teams.create(name),
      onSuccess: invalidate,
      onError: onError('Could not create the team'),
    }),
    rename: useMutation({
      mutationFn: (vars: { teamId: string; name: string }) => api.teams.rename(vars.teamId, vars.name),
      onSuccess: invalidate,
      onError: onError('Could not rename the team'),
    }),
    remove: useMutation({
      mutationFn: (teamId: string) => api.teams.remove(teamId),
      onSuccess: invalidate,
      onError: onError('Could not delete the team'),
    }),
    addMembers: useMutation({
      mutationFn: (vars: { teamId: string; userIds: string[] }) =>
        api.teams.addMembers(vars.teamId, vars.userIds),
      onSuccess: invalidate,
      onError: onError('Could not add team members'),
    }),
    removeMembers: useMutation({
      mutationFn: (vars: { teamId: string; userIds: string[] }) =>
        api.teams.removeMembers(vars.teamId, vars.userIds),
      onSuccess: invalidate,
      onError: onError('Could not remove team members'),
    }),
  };
}

export function useAuditLog(filters: { action?: string; actorId?: string } = {}) {
  const api = useApi();
  const orgId = useOrgId();
  return useInfiniteQuery({
    queryKey: queryKeys.auditLog(orgId, filters),
    queryFn: ({ pageParam }) => api.auditLog({ ...filters, cursor: pageParam ?? undefined, limit: 50 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: Paginated<AuditLogDto>) => last.nextCursor,
  });
}

// Dashboards ----------------------------------------------------------------------------------------

export function useDashboards(workspaceId?: string) {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: queryKeys.dashboards(orgId, workspaceId),
    queryFn: () => api.dashboards.list(workspaceId),
  });
}

export function useDashboard(dashboardId: string | undefined) {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: queryKeys.dashboard(orgId, dashboardId ?? ''),
    queryFn: () => api.dashboards.get(dashboardId as string),
    enabled: Boolean(dashboardId),
  });
}

export function useWidgetData(widgetId: string | undefined) {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: queryKeys.widgetData(orgId, widgetId ?? ''),
    queryFn: ({ signal }) => api.dashboards.widgetData(widgetId as string, signal),
    enabled: Boolean(widgetId),
    staleTime: 30_000,
  });
}

export function useDashboardMutations(dashboardId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(orgId, dashboardId) });
  return {
    update: useMutation({
      mutationFn: (input: { name?: string; description?: string | null; boardIds?: string[] }) =>
        api.dashboards.update(dashboardId, input),
      onSuccess: () =>
        Promise.all([invalidate(), queryClient.invalidateQueries({ queryKey: ['org', orgId, 'widget'] })]),
      onError: (error) => toastError(error, 'Could not update the dashboard'),
    }),
    addWidget: useMutation({
      mutationFn: (input: Omit<DashboardWidgetDto, 'id' | 'dashboardId'>) =>
        api.dashboards.addWidget(dashboardId, input),
      onSuccess: invalidate,
      onError: (error) => toastError(error, 'Could not add the widget'),
    }),
    updateWidget: useMutation({
      mutationFn: (vars: {
        widgetId: string;
        input: Partial<Omit<DashboardWidgetDto, 'id' | 'dashboardId' | 'type'>>;
      }) => api.dashboards.updateWidget(vars.widgetId, vars.input),
      onSuccess: (widget) =>
        Promise.all([
          invalidate(),
          queryClient.invalidateQueries({ queryKey: queryKeys.widgetData(orgId, widget.id) }),
        ]),
      onError: (error) => toastError(error, 'Could not update the widget'),
    }),
    removeWidget: useMutation({
      mutationFn: (widgetId: string) => api.dashboards.removeWidget(widgetId),
      onSuccess: invalidate,
      onError: (error) => toastError(error, 'Could not remove the widget'),
    }),
  };
}

// Automations ---------------------------------------------------------------------------------------

export function useAutomations(boardId: string | undefined) {
  const api = useApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: queryKeys.boardAutomations(orgId, boardId ?? ''),
    queryFn: () => api.automations.list(boardId as string),
    enabled: Boolean(boardId),
  });
}

export function useAutomationRuns(automationId: string | undefined) {
  const api = useApi();
  const orgId = useOrgId();
  return useInfiniteQuery({
    queryKey: queryKeys.automationRuns(orgId, automationId ?? ''),
    queryFn: ({ pageParam }) =>
      api.automations.runs(automationId as string, { cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: Paginated<AutomationRunDto>) => last.nextCursor,
    enabled: Boolean(automationId),
  });
}

export function useAutomationMutations(boardId: string) {
  const api = useApi();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const key = queryKeys.boardAutomations(orgId, boardId);
  return {
    create: useMutation({
      mutationFn: (input: CreateAutomationInput) => api.automations.create(boardId, input),
      onSuccess: (automation) =>
        queryClient.setQueryData<AutomationDto[]>(key, (list) => [...(list ?? []), automation]),
      onError: (error) => toastError(error, 'Could not create the automation'),
    }),
    update: useMutation({
      mutationFn: (vars: { automationId: string; input: UpdateAutomationInput }) =>
        api.automations.update(vars.automationId, vars.input),
      onMutate: async (vars) => {
        const saved = await snapshot(queryClient, key);
        if (vars.input.enabled !== undefined) {
          queryClient.setQueryData<AutomationDto[]>(key, (list) =>
            list?.map((entry) =>
              entry.id === vars.automationId ? { ...entry, enabled: vars.input.enabled as boolean } : entry,
            ),
          );
        }
        return { saved };
      },
      onError: (error, _vars, context) => {
        restore(queryClient, context?.saved);
        toastError(error, 'Could not update the automation');
      },
      onSuccess: (automation) =>
        queryClient.setQueryData<AutomationDto[]>(key, (list) =>
          list?.map((entry) => (entry.id === automation.id ? automation : entry)),
        ),
    }),
    remove: useMutation({
      mutationFn: (automationId: string) => api.automations.remove(automationId),
      onSuccess: (result) =>
        queryClient.setQueryData<AutomationDto[]>(key, (list) =>
          list?.filter((entry) => entry.id !== result.id),
        ),
      onError: (error) => toastError(error, 'Could not delete the automation'),
    }),
  };
}
