'use client';
/**
 * Workspace overview "Members & permissions" tab: the explicit member list with an inline role
 * select (owner / member) and a remove action (visible on hover and keyboard focus), plus an
 * access summary card. Every write is optimistic with rollback; removal offers Undo.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Globe, Lock, UserMinus, UserPlus } from 'lucide-react';
import { Avatar, Button, Combobox, IconButton, Select, Skeleton, toast } from '@/components/ui';
import { apiRequest } from '@/lib/api';
import { useMembers } from '@/lib/hooks';
import type { WorkspaceMemberDto } from '@/server/services/shell-workspace';
import type { WorkspaceDto } from '../api';
import { useCan, useOrg } from '../org-context';
import { canManageMembers } from './workspace-members-model';
import { useShellStore } from '../store';
import { useWorkspaceMembers } from './workspace-page';

const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'member', label: 'Member' },
];

type Role = WorkspaceMemberDto['role'];

function errorText(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function useMemberWrites(orgId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  const key = ['org', orgId, 'workspaces', workspaceId, 'members'] as const;
  const base = `/shell/workspaces/${workspaceId}/members`;

  const optimistic = async (
    update: (list: WorkspaceMemberDto[]) => WorkspaceMemberDto[],
    call: () => Promise<unknown>,
    failure: string,
  ): Promise<boolean> => {
    await queryClient.cancelQueries({ queryKey: key });
    const previous = queryClient.getQueryData<WorkspaceMemberDto[]>(key);
    queryClient.setQueryData<WorkspaceMemberDto[]>(key, (current = []) => update(current));
    try {
      await call();
      return true;
    } catch (error) {
      if (previous) queryClient.setQueryData(key, previous);
      toast.error(failure, errorText(error));
      return false;
    } finally {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const add = (person: WorkspaceMemberDto) =>
    optimistic(
      (list) => [...list.filter((entry) => entry.userId !== person.userId), person].sort((a, b) => a.name.localeCompare(b.name)),
      () => apiRequest(base, { method: 'POST', orgId, body: { userId: person.userId, role: person.role } }),
      `Couldn't add ${person.name}`,
    );

  const setRole = (person: WorkspaceMemberDto, role: Role) =>
    optimistic(
      (list) => list.map((entry) => (entry.userId === person.userId ? { ...entry, role } : entry)),
      () => apiRequest(`${base}/${person.userId}`, { method: 'PATCH', orgId, body: { role } }),
      `Couldn't change ${person.name}'s role`,
    );

  const remove = async (person: WorkspaceMemberDto) => {
    const ok = await optimistic(
      (list) => list.filter((entry) => entry.userId !== person.userId),
      () => apiRequest(`${base}/${person.userId}`, { method: 'DELETE', orgId }),
      `Couldn't remove ${person.name}`,
    );
    if (ok) toast.undo(`${person.name} removed from the workspace`, { onUndo: () => void add(person) });
  };

  return { add, setRole, remove };
}

export function WorkspaceMembersTab({ workspace }: { readonly workspace: WorkspaceDto }) {
  const { org, role: orgRole, user } = useOrg();
  const hasWorkspaceWrite = useCan('workspace:write');
  const canInvite = useCan('member:invite');
  const openPanel = useShellStore((state) => state.openPanel);
  const members = useWorkspaceMembers(org.id, workspace.id);
  const orgMembers = useMembers();
  const writes = useMemberWrites(org.id, workspace.id);
  const [adding, setAdding] = useState<string | null>(null);
  const current = members.data ?? [];
  const canWrite = hasWorkspaceWrite && canManageMembers({ orgRole, userId: user.id, members: current });
  const ownerCount = current.filter((member) => member.role === 'owner').length;
  const candidates = (orgMembers.data ?? []).filter((member) => !current.some((entry) => entry.userId === member.userId));

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section aria-labelledby="ws-members" className="overflow-hidden rounded-lg border border-border-subtle bg-panel">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <h2 id="ws-members" className="text-md font-semibold text-fg">
            Members <span className="font-sans text-sm font-normal text-fg-muted">{current.length || ''}</span>
          </h2>
          {canWrite ? (
            <div className="flex items-center gap-2">
              <Combobox
                value={adding}
                onValueChange={(value) => {
                  setAdding(null);
                  const person = candidates.find((member) => member.userId === value);
                  if (!person) return;
                  void writes.add({
                    userId: person.userId,
                    name: person.name,
                    email: person.email,
                    image: person.image,
                    title: person.title,
                    role: 'member',
                  });
                }}
                options={candidates.map((member) => ({ value: member.userId, label: member.name, description: member.email }))}
                placeholder="Add member…"
                aria-label="Add a member to this workspace"
                className="w-56"
              />
              {canInvite ? (
                <Button variant="secondary" size="sm" leadingIcon={<UserPlus aria-hidden />} onClick={() => openPanel('invite')}>
                  Invite
                </Button>
              ) : null}
            </div>
          ) : null}
        </header>
        {members.isPending ? (
          <div className="flex flex-col gap-2 p-4" data-skeleton>
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} height={40} rounded="md" />
            ))}
          </div>
        ) : current.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-fg-muted">
            {workspace.kind === 'open'
              ? 'No explicit members. Everyone in the organization can open this workspace.'
              : 'No members yet. Add people so they can see this closed workspace.'}
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {current.map((member) => (
              <li
                key={member.userId}
                className="group flex h-14 items-center gap-3 px-4 transition-colors hover:bg-hover focus-within:bg-hover"
                data-testid="workspace-member-row"
              >
                <Avatar name={member.name} src={member.image} colorKey={member.userId} size="md" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium text-fg">{member.name}</span>
                  <span className="truncate text-xs text-fg-muted">
                    {member.title ? `${member.title} · ${member.email}` : member.email}
                  </span>
                </span>
                {canWrite ? (
                  <>
                    <Select
                      value={member.role}
                      onValueChange={(role) => {
                        if (role !== member.role) void writes.setRole(member, role as Role);
                      }}
                      options={ROLE_OPTIONS}
                      size="sm"
                      aria-label={`Workspace role for ${member.name}`}
                      className="w-28"
                    />
                    <IconButton
                      label={
                        member.role === 'owner' && ownerCount <= 1
                          ? `${member.name} is the last owner and can't be removed`
                          : `Remove ${member.name} from the workspace`
                      }
                      disabled={member.role === 'owner' && ownerCount <= 1}
                      icon={<UserMinus aria-hidden />}
                      size="sm"
                      variant="danger"
                      className="opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                      onClick={() => void writes.remove(member)}
                    />
                  </>
                ) : (
                  <span className="text-sm text-fg-secondary capitalize">{member.role}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <aside className="flex flex-col gap-3 self-start rounded-lg border border-border-subtle bg-sunken p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          {workspace.kind === 'closed' ? <Lock aria-hidden className="size-4 text-icon" /> : <Globe aria-hidden className="size-4 text-icon" />}
          {workspace.kind === 'closed' ? 'Closed workspace' : 'Open workspace'}
        </h2>
        <p className="text-sm text-fg-secondary">
          {workspace.kind === 'closed'
            ? 'Only members listed here (and org admins) can see its boards and dashboards.'
            : 'Everyone in the organization can find and open its main boards. Private boards still need an invite.'}
        </p>
        <p className="text-sm text-fg-secondary">
          <span className="font-semibold text-fg">Owners</span> can rename the workspace, manage members and delete it.{' '}
          <span className="font-semibold text-fg">Members</span> can create and edit boards inside it.
        </p>
        {!canWrite && current.length > 0 ? (
          <p className="text-sm text-fg-muted" data-testid="workspace-members-readonly">
            Only workspace owners and org admins can change members.
          </p>
        ) : null}
      </aside>
    </div>
  );
}
