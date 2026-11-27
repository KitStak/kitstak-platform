'use client';
/**
 * Admin → Users: searchable, filterable directory with inline role change, deactivate /
 * reactivate (Undo toast), bulk actions, pending invitations (resend / revoke) and CSV export.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, Download, MoreHorizontal, RotateCcw, Send, UserMinus, UserPlus, UserCheck, X, Copy, MailX } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  CountBadge,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  SearchInput,
  Select,
  Tooltip,
  cn,
  toast,
} from '@/components/ui';
import { toastError, useOrgId, useTeams } from '@/lib/hooks';
import { useOrg } from '@/features/shell/org-context';
import { canManageRole, ORG_ROLES, type OrgRole } from '@/server/rbac/permissions';
import type { AdminInvitationDto, AdminUserDto } from '@/server/services/admin-contracts';
import {
  downloadCsv,
  useAdminUsers,
  useBulkUsers,
  useOrgAdmin,
  useResendInvitation,
  useRevokeInvitationOptimistic,
} from '../api';
import { filterUsers, formatDate, pluralize, relativeTime, ROLE_LABEL, roleChangeNeedsConfirm, type StatusFilter } from '../format';
import {
  ErrorPanel,
  RoleBadge,
  SectionHeader,
  SettingsCard,
  SortableHeader,
  TABLE_CELL,
  TABLE_HEAD,
  TABLE_ROW,
  TableSkeleton,
  useTableSort,
} from '../ui';
import { InviteMembersDialog } from './invite-members-dialog';

type UserSortKey = 'name' | 'role' | 'lastActive' | 'joined';
const ROLE_ORDER: Readonly<Record<OrgRole, number>> = { owner: 0, admin: 1, member: 2, viewer: 3, guest: 4 };
const USER_SORT: Readonly<Record<UserSortKey, (row: AdminUserDto) => string | number | null>> = {
  name: (row) => row.name,
  role: (row) => ROLE_ORDER[row.role],
  lastActive: (row) => (row.lastActiveAt ? Date.parse(row.lastActiveAt) : null),
  joined: (row) => Date.parse(row.joinedAt),
};

const ROLE_POWERS: Readonly<Partial<Record<OrgRole, string>>> = {
  owner: 'Owners can do everything, including billing, deleting the organization and managing other owners.',
  admin: 'Admins can manage members, teams, security policy, API tokens and every board in the organization.',
};

interface RoleChange {
  readonly members: ReadonlyArray<{ readonly memberId: string; readonly name: string; readonly role: OrgRole }>;
  readonly role: OrgRole;
}

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'deactivated', label: 'Deactivated' },
  { value: 'invited', label: 'Pending invitations' },
];

export function UsersSection() {
  const orgId = useOrgId();
  const { user: me, role: actorRole, permissions } = useOrg();
  const users = useAdminUsers();
  const org = useOrgAdmin();
  const teams = useTeams();
  const bulk = useBulkUsers();
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<OrgRole | 'all'>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ ids: string[]; names: string } | null>(null);
  const [roleConfirm, setRoleConfirm] = useState<RoleChange | null>(null);
  const [invitesOpen, setInvitesOpen] = useState(true);
  const [exporting, setExporting] = useState(false);

  const filteredUsers = useMemo(
    () => filterUsers(users.data?.users ?? [], { q, role: roleFilter, status }),
    [users.data, q, roleFilter, status],
  );
  const { sorted: list, sort, toggle: toggleSort } = useTableSort(filteredUsers, USER_SORT, { key: 'name', direction: 'asc' });
  const invites = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (users.data?.invitations ?? []).filter(
      (entry) => (roleFilter === 'all' || entry.role === roleFilter) && (!term || entry.email.includes(term)),
    );
  }, [users.data, q, roleFilter]);
  const teamName = useMemo(() => new Map((teams.data ?? []).map((entry) => [entry.id, entry.name])), [teams.data]);
  const manageable = (entry: AdminUserDto) => entry.userId !== me.id && canManageRole(actorRole, entry.role);
  const selectable = list.filter(manageable);
  const selectedRows = list.filter((entry) => selected.has(entry.memberId));
  const allSelected = selectable.length > 0 && selectable.every((entry) => selected.has(entry.memberId));
  const counts = {
    active: users.data?.users.filter((entry) => entry.status === 'active').length ?? 0,
    deactivated: users.data?.users.filter((entry) => entry.status === 'deactivated').length ?? 0,
    invited: users.data?.invitations.length ?? 0,
  };

  const toggle = (memberId: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(memberId);
      else next.delete(memberId);
      return next;
    });

  const runBulk = (action: 'set_role' | 'deactivate' | 'reactivate', ids: string[], role?: OrgRole) => {
    bulk.mutate(
      { action, memberIds: ids, role },
      {
        onSuccess: (result) => {
          setSelected(new Set());
          if (result.failed.length > 0) {
            toast.error(
              `${pluralize(result.failed.length, 'member')} not updated`,
              result.failed.map((entry) => entry.reason).join(' · '),
            );
          }
          if (result.updated.length === 0) return;
          if (action === 'deactivate') {
            toast.undo(`${pluralize(result.updated.length, 'member')} deactivated`, {
              description: 'They can no longer sign in to this organization.',
              onUndo: () => bulk.mutateAsync({ action: 'reactivate', memberIds: [...result.updated] }).then(() => undefined),
            });
          } else if (action === 'reactivate') {
            toast.success(`${pluralize(result.updated.length, 'member')} reactivated`);
          } else {
            const previous = (users.data?.users ?? []).filter((entry) => result.updated.includes(entry.memberId));
            toast.undo(`Role changed to ${ROLE_LABEL[role as OrgRole]}`, {
              description: previous.length === 1 ? previous[0]?.name : pluralize(result.updated.length, 'member'),
              onUndo: async () => {
                const byRole = new Map<OrgRole, string[]>();
                for (const entry of previous) byRole.set(entry.role, [...(byRole.get(entry.role) ?? []), entry.memberId]);
                for (const [prevRole, memberIds] of byRole) {
                  await bulk.mutateAsync({ action: 'set_role', memberIds, role: prevRole });
                }
                toast.success('Role change undone');
              },
            });
          }
        },
      },
    );
  };

  /** Role change entry point: confirms escalations / admin demotions, applies the rest directly. */
  const requestRole = (targets: readonly AdminUserDto[], role: OrgRole) => {
    const changing = targets.filter((entry) => entry.role !== role);
    if (changing.length === 0) return;
    if (changing.some((entry) => roleChangeNeedsConfirm(entry.role, role))) {
      setRoleConfirm({ members: changing.map(({ memberId, name, role: current }) => ({ memberId, name, role: current })), role });
      return;
    }
    runBulk('set_role', changing.map((entry) => entry.memberId), role);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCsv(orgId, '/admin/users/export');
      toast.success('Export downloaded', 'kitstak-users.csv');
    } catch (error) {
      toastError(error, 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const showInvites = status === 'invited';
  const showInviteSection = status === 'all' && invites.length > 0 && permissions.includes('member:invite');
  const filtersActive = q !== '' || roleFilter !== 'all' || status !== 'all';

  return (
    <>
      <SectionHeader
        title="Users"
        actions={
          <>
            {permissions.includes('data:export') ? (
              <Button variant="secondary" leadingIcon={<Download aria-hidden />} loading={exporting} onClick={() => void exportCsv()} data-testid="users-export">
                Export CSV
              </Button>
            ) : null}
            {permissions.includes('member:invite') ? (
              <Button leadingIcon={<UserPlus aria-hidden />} onClick={() => setInviteOpen(true)} data-testid="users-invite">
                Invite people
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        {(
          [
            ['Active', counts.active, 'active'],
            ['Deactivated', counts.deactivated, 'deactivated'],
            ['Invited', counts.invited, 'invited'],
          ] as const
        ).map(([label, value, key]) => (
          <button
            key={key}
            type="button"
            aria-pressed={status === key}
            onClick={() => setStatus(status === key ? 'all' : key)}
            className={cn(
              'flex flex-col items-start rounded-lg border bg-panel px-4 py-3 text-left shadow-xs transition-[border-color,background-color] duration-[var(--duration-fast)]',
              'hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:bg-pressed',
              status === key ? 'border-border-strong bg-selected' : 'border-border-subtle',
            )}
          >
            <span className="text-sm text-fg-secondary">{label}</span>
            <span className="text-xl font-semibold text-fg tabular-nums">{users.data ? value : '…'}</span>
          </button>
        ))}
      </div>

      <SettingsCard padded={false} testId="users-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-3 sm:px-5">
          <SearchInput
            value={q}
            onValueChange={setQ}
            placeholder="Search name, email or title"
            containerClassName="w-full sm:w-72"
            aria-label="Search users"
            data-testid="users-search"
          />
          <Select
            aria-label="Filter by role"
            className="w-[calc(50%-4px)] sm:w-40"
            value={roleFilter}
            onValueChange={(value) => setRoleFilter(value as OrgRole | 'all')}
            options={[{ value: 'all', label: 'All roles' }, ...ORG_ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role] }))]}
          />
          <Select
            aria-label="Filter by status"
            className="w-[calc(50%-4px)] sm:w-48"
            value={status}
            onValueChange={(value) => setStatus(value as StatusFilter)}
            options={STATUS_OPTIONS}
          />
          {filtersActive ? (
            <Button variant="ghost" size="sm" onClick={() => { setQ(''); setRoleFilter('all'); setStatus('all'); }}>
              Clear filters
            </Button>
          ) : null}
        </div>

        {selectedRows.length > 0 && !showInvites ? (
          <div
            role="toolbar"
            aria-label="Bulk actions"
            data-testid="users-bulk-bar"
            className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-selected px-4 py-2 animate-fade-in sm:px-5"
          >
            <span className="text-sm font-semibold text-fg">{selectedRows.length} selected</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="secondary" loading={bulk.isPending}>Change role</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Set role for {selectedRows.length}</DropdownMenuLabel>
                {ORG_ROLES.filter((role) => canManageRole(actorRole, role)).map((role) => (
                  <DropdownMenuItem key={role} onSelect={() => requestRole(selectedRows, role)}>
                    {ROLE_LABEL[role]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<UserMinus aria-hidden />}
              disabled={!selectedRows.some((entry) => entry.status === 'active')}
              onClick={() => {
                const targets = selectedRows.filter((entry) => entry.status === 'active');
                setConfirm({ ids: targets.map((entry) => entry.memberId), names: pluralize(targets.length, 'member') });
              }}
            >
              Deactivate
            </Button>
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<UserCheck aria-hidden />}
              disabled={!selectedRows.some((entry) => entry.status === 'deactivated')}
              onClick={() =>
                runBulk('reactivate', selectedRows.filter((entry) => entry.status === 'deactivated').map((entry) => entry.memberId))
              }
            >
              Reactivate
            </Button>
            <IconButton label="Clear selection" icon={<X aria-hidden />} size="sm" className="ml-auto" onClick={() => setSelected(new Set())} />
          </div>
        ) : null}

        {users.isPending ? (
          <TableSkeleton rows={7} columns={4} />
        ) : users.isError ? (
          <ErrorPanel title="Couldn't load users" onRetry={() => void users.refetch()} />
        ) : showInvites ? (
          <InvitationsTable invitations={invites} />
        ) : list.length === 0 ? (
          <EmptyState
            size="sm"
            illustration="search"
            title="No users match"
            description="Try a different name, role or status."
            actions={<Button variant="secondary" size="sm" onClick={() => { setQ(''); setRoleFilter('all'); setStatus('all'); }}>Clear filters</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-base sm:table-auto sm:min-w-[640px]" data-testid="users-table">
              <thead className="border-b border-border-subtle bg-sunken/60">
                <tr>
                  <th className={cn(TABLE_HEAD, 'w-10 pr-0')}>
                    <Checkbox
                      aria-label="Select all users"
                      checked={allSelected ? true : selectedRows.length > 0 ? 'indeterminate' : false}
                      disabled={selectable.length === 0}
                      onCheckedChange={(value) =>
                        setSelected(value === true ? new Set(selectable.map((entry) => entry.memberId)) : new Set())
                      }
                    />
                  </th>
                  <SortableHeader label="User" sortKey="name" sort={sort} onSort={toggleSort} />
                  <SortableHeader label="Role" sortKey="role" sort={sort} onSort={toggleSort} className="w-28 sm:w-36" />
                  <th className={cn(TABLE_HEAD, 'hidden w-[200px] min-w-[160px] xl:table-cell')}>Teams</th>
                  <SortableHeader label="Last active" sortKey="lastActive" sort={sort} onSort={toggleSort} className="hidden md:table-cell" />
                  <SortableHeader label="Joined" sortKey="joined" sort={sort} onSort={toggleSort} className="hidden 2xl:table-cell" />
                  <th className={cn(TABLE_HEAD, 'hidden sm:table-cell')}>Status</th>
                  <th className={cn(TABLE_HEAD, 'w-12')}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((entry) => (
                  <UserRow
                    key={entry.memberId}
                    entry={entry}
                    isMe={entry.userId === me.id}
                    canManage={manageable(entry)}
                    actorRole={actorRole}
                    selected={selected.has(entry.memberId)}
                    onSelect={(on) => toggle(entry.memberId, on)}
                    teamNames={entry.teamIds.map((id) => teamName.get(id)).filter((name): name is string => Boolean(name))}
                    onRole={(role) => requestRole([entry], role)}
                    onDeactivate={() => setConfirm({ ids: [entry.memberId], names: entry.name })}
                    onReactivate={() => runBulk('reactivate', [entry.memberId])}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {users.data && !showInvites && list.length > 0 ? (
          <p className="border-t border-border-subtle px-5 py-2.5 text-sm text-fg-muted" aria-live="polite">
            Showing {pluralize(list.length, 'user')}
            {users.data.users.length !== list.length ? ` of ${users.data.users.length}` : ''}
          </p>
        ) : null}
      </SettingsCard>

      {showInviteSection ? (
        <SettingsCard padded={false} testId="pending-invites">
          <button
            type="button"
            aria-expanded={invitesOpen}
            aria-controls="pending-invites-body"
            onClick={() => setInvitesOpen((open) => !open)}
            className="flex w-full items-center gap-2 px-5 py-3.5 text-left transition-colors duration-[var(--duration-instant)] hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus active:bg-pressed"
            data-testid="pending-invites-toggle"
          >
            <ChevronDown aria-hidden className={cn('size-4 text-icon transition-transform duration-[var(--duration-fast)]', !invitesOpen && '-rotate-90')} />
            <span className="text-md font-semibold text-fg">Pending invitations</span>
            <CountBadge count={invites.length} label="pending" />
            <span className="ml-auto hidden text-sm text-fg-muted sm:inline">Waiting for people to accept · links expire after 7 days</span>
          </button>
          {invitesOpen ? (
            <div id="pending-invites-body" className="border-t border-border-subtle">
              <InvitationsTable invitations={invites} />
            </div>
          ) : null}
        </SettingsCard>
      ) : null}

      <InviteMembersDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        allowedDomains={org.data?.settings.allowedEmailDomains ?? []}
      />
      <ConfirmDialog
        open={roleConfirm !== null}
        onOpenChange={(open) => (open ? undefined : setRoleConfirm(null))}
        destructive={roleConfirm?.role === 'owner'}
        title={
          roleConfirm
            ? roleConfirm.members.length === 1
              ? `Change ${roleConfirm.members[0]?.name ?? ''} to ${ROLE_LABEL[roleConfirm.role]}?`
              : `Change ${roleConfirm.members.length} members to ${ROLE_LABEL[roleConfirm.role]}?`
            : ''
        }
        description={
          roleConfirm ? (
            <span data-testid="role-confirm-description">
              {ROLE_POWERS[roleConfirm.role] ??
                `${ROLE_LABEL[roleConfirm.role]}s lose admin rights: they can no longer manage members, security or org settings.`}{' '}
              {roleConfirm.members.some((entry) => entry.role === 'owner' || entry.role === 'admin') && !ROLE_POWERS[roleConfirm.role]
                ? `This removes admin access from ${roleConfirm.members.filter((entry) => entry.role === 'owner' || entry.role === 'admin').map((entry) => entry.name).join(', ')}.`
                : 'You can undo this right after.'}
            </span>
          ) : undefined
        }
        confirmLabel={roleConfirm ? `Make ${ROLE_LABEL[roleConfirm.role]}` : 'Confirm'}
        onConfirm={() => {
          if (roleConfirm) runBulk('set_role', roleConfirm.members.map((entry) => entry.memberId), roleConfirm.role);
          setRoleConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => (open ? undefined : setConfirm(null))}
        destructive
        title={`Deactivate ${confirm?.names ?? ''}?`}
        description="They’ll lose access to this organization immediately. Their boards, items and history are kept, and you can reactivate them at any time."
        confirmLabel="Deactivate"
        onConfirm={() => {
          if (confirm) runBulk('deactivate', confirm.ids);
          setConfirm(null);
        }}
      />
    </>
  );
}

function UserRow({
  entry,
  isMe,
  canManage,
  actorRole,
  selected,
  onSelect,
  teamNames,
  onRole,
  onDeactivate,
  onReactivate,
}: {
  readonly entry: AdminUserDto;
  readonly isMe: boolean;
  readonly canManage: boolean;
  readonly actorRole: OrgRole;
  readonly selected: boolean;
  readonly onSelect: (on: boolean) => void;
  readonly teamNames: readonly string[];
  readonly onRole: (role: OrgRole) => void;
  readonly onDeactivate: () => void;
  readonly onReactivate: () => void;
}) {
  const deactivated = entry.status === 'deactivated';
  return (
    <tr className={cn(TABLE_ROW, selected && 'bg-selected hover:bg-selected-hover')} data-testid="users-row" data-member-id={entry.memberId}>
      <td className={cn(TABLE_CELL, 'w-10 pr-0')}>
        <Checkbox
          aria-label={`Select ${entry.name}`}
          checked={selected}
          disabled={!canManage}
          onCheckedChange={(value) => onSelect(value === true)}
        />
      </td>
      <td className={cn(TABLE_CELL, 'xl:max-w-[340px]')}>
        <span className={cn('flex min-w-0 items-center gap-3', deactivated && 'opacity-60')} title={entry.title ?? undefined}>
          <Avatar name={entry.name} src={entry.image} size="md" />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-medium text-fg">{entry.name}</span>
              {isMe ? <Badge tone="outline">You</Badge> : null}
              {deactivated ? <Badge className="sm:hidden">Off</Badge> : null}
            </span>
            <span className="block truncate text-sm text-fg-muted">{entry.email}</span>
          </span>
        </span>
      </td>
      <td className={TABLE_CELL}>
        {canManage && !deactivated ? (
          <Select
            size="sm"
            aria-label={`Role for ${entry.name}`}
            value={entry.role}
            onValueChange={(value) => onRole(value as OrgRole)}
            options={ORG_ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role], disabled: !canManageRole(actorRole, role) }))}
          />
        ) : (
          <Tooltip content={isMe ? 'You can’t change your own role here' : deactivated ? 'Reactivate to change the role' : 'Only a higher role can change this'}>
            <span tabIndex={0} className="inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-focus">
              <RoleBadge role={entry.role} />
            </span>
          </Tooltip>
        )}
      </td>
      <td className={cn(TABLE_CELL, 'hidden min-w-[160px] xl:table-cell')}>
        <TeamChips names={teamNames} />
      </td>
      <td className={cn(TABLE_CELL, 'hidden text-sm whitespace-nowrap text-fg-secondary md:table-cell')}>
        <Tooltip content={`Joined ${formatDate(entry.joinedAt)}`}>
          <span tabIndex={0} className="rounded-sm focus-visible:outline-2 focus-visible:outline-focus">{relativeTime(entry.lastActiveAt)}</span>
        </Tooltip>
      </td>
      <td className={cn(TABLE_CELL, 'hidden text-sm whitespace-nowrap text-fg-secondary 2xl:table-cell')}>{formatDate(entry.joinedAt)}</td>
      <td className={cn(TABLE_CELL, 'hidden sm:table-cell')}>
        {deactivated ? <Badge tone="neutral">Deactivated</Badge> : <Badge tone="success">Active</Badge>}
      </td>
      <td className={cn(TABLE_CELL, 'w-12 text-right')}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={`Actions for ${entry.name}`} icon={<MoreHorizontal aria-hidden />} size="sm" hideTooltip />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              icon={<Copy aria-hidden />}
              onSelect={() => {
                void navigator.clipboard?.writeText(entry.email).then(
                  () => toast.success('Email copied'),
                  () => toast.error('Could not copy'),
                );
              }}
            >
              Copy email
            </DropdownMenuItem>
            {canManage && !deactivated ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Change role</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={entry.role} onValueChange={(value) => onRole(value as OrgRole)}>
                  {ORG_ROLES.filter((role) => canManageRole(actorRole, role)).map((role) => (
                    <DropdownMenuRadioItem key={role} value={role}>
                      {ROLE_LABEL[role]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            ) : null}
            {canManage ? (
              <>
                <DropdownMenuSeparator />
                {deactivated ? (
                  <DropdownMenuItem icon={<RotateCcw aria-hidden />} onSelect={onReactivate}>
                    Reactivate
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem icon={<UserMinus aria-hidden />} variant="danger" onSelect={onDeactivate}>
                    Deactivate…
                  </DropdownMenuItem>
                )}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

function InvitationsTable({ invitations }: { readonly invitations: readonly AdminInvitationDto[] }) {
  const resend = useResendInvitation();
  const revoke = useRevokeInvitationOptimistic();
  const [confirm, setConfirm] = useState<AdminInvitationDto | null>(null);
  if (invitations.length === 0) {
    return (
      <EmptyState size="sm" illustration="inbox" title="No pending invitations" />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-base" data-testid="invites-table">
        <thead className="border-b border-border-subtle bg-sunken/60">
          <tr>
            <th className={TABLE_HEAD}>Email</th>
            <th className={TABLE_HEAD}>Role</th>
            <th className={cn(TABLE_HEAD, 'hidden md:table-cell')}>Invited by</th>
            <th className={TABLE_HEAD}>Expires</th>
            <th className={cn(TABLE_HEAD, 'text-right')}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {invitations.map((entry) => (
            <tr key={entry.id} className={TABLE_ROW}>
              <td className={cn(TABLE_CELL, 'font-medium text-fg')}>{entry.email}</td>
              <td className={TABLE_CELL}>
                <RoleBadge role={entry.role} />
              </td>
              <td className={cn(TABLE_CELL, 'hidden text-sm text-fg-secondary md:table-cell')}>
                {entry.inviterName ?? 'None'} · {relativeTime(entry.createdAt)}
              </td>
              <td className={cn(TABLE_CELL, 'text-sm whitespace-nowrap')}>
                {entry.expired ? <Badge tone="danger">Expired</Badge> : <span className="text-fg-secondary">{relativeTime(entry.expiresAt)}</span>}
              </td>
              <td className={cn(TABLE_CELL, 'text-right whitespace-nowrap')}>
                <span className="inline-flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<Send aria-hidden />}
                    loading={resend.isPending && resend.variables === entry.id}
                    onClick={() => resend.mutate(entry.id, { onSuccess: () => toast.success('Invitation resent', entry.email) })}
                  >
                    Resend
                  </Button>
                  <Button size="sm" variant="danger-ghost" leadingIcon={<MailX aria-hidden />} onClick={() => setConfirm(entry)}>
                    Revoke
                  </Button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => (open ? undefined : setConfirm(null))}
        destructive
        title="Revoke this invitation?"
        description={`The link sent to ${confirm?.email ?? ''} will stop working. You can invite them again later.`}
        confirmLabel="Revoke"
        onConfirm={() => {
          if (confirm) revoke.mutate(confirm.id, { onSuccess: () => toast.success('Invitation revoked') });
          setConfirm(null);
        }}
      />
    </div>
  );
}

/** First team as a chip, the rest behind a "+N" chip whose tooltip lists every team. */
function TeamChips({ names }: { readonly names: readonly string[] }) {
  if (names.length === 0) return <span className="text-sm text-fg-muted">None</span>;
  const [first, ...rest] = names;
  return (
    <span className="flex min-w-0 items-center gap-1" data-testid="user-teams">
      <Badge className="min-w-0 max-w-[150px]">{first}</Badge>
      {rest.length > 0 ? (
        <Tooltip content={names.join(', ')}>
          <span
            tabIndex={0}
            className="inline-flex h-5 shrink-0 items-center rounded-full bg-muted px-2 text-xs font-medium text-fg-secondary focus-visible:outline-2 focus-visible:outline-focus"
            aria-label={`${rest.length} more teams: ${rest.join(', ')}`}
          >
            +{rest.length}
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}
