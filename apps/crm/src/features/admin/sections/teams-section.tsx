'use client';
/** Admin → Teams: create, rename, delete teams; manage members and team owners. */
import { useMemo, useState } from 'react';
import { Crown, MoreHorizontal, Pencil, Plus, Trash2, UserMinus, UsersRound } from 'lucide-react';
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Combobox,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
  Tooltip,
  cn,
  toast,
} from '@/components/ui';
import { useMembers, useTeamMutations, useTeams } from '@/lib/hooks';
import type { MemberDto, TeamDto } from '@/server/services/contracts/dto';
import { useOrgAdmin, useSetTeamOwners } from '../api';
import { pluralize } from '../format';
import { ErrorPanel, SectionHeader, SettingsCard, TableSkeleton } from '../ui';

export function TeamsSection() {
  const teams = useTeams();
  const members = useMembers();
  const org = useOrgAdmin();
  const mutations = useTeamMutations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  const list = useMemo(() => teams.data ?? [], [teams.data]);
  const selected = list.find((entry) => entry.id === selectedId) ?? list[0] ?? null;
  const memberById = useMemo(() => new Map((members.data ?? []).map((entry) => [entry.userId, entry])), [members.data]);
  const owners = org.data?.settings.teamOwners ?? {};

  const create = () => {
    const name = newName.trim();
    if (name.length === 0) {
      setNameError('Give the team a name');
      return;
    }
    if (list.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
      setNameError('A team with this name already exists');
      return;
    }
    setNameError(null);
    mutations.create.mutate(name, {
      onSuccess: (team) => {
        setNewName('');
        setSelectedId(team.id);
        toast.success(`Team “${team.name}” created`);
      },
    });
  };

  return (
    <>
      <SectionHeader title="Teams" />
      <SettingsCard padded={false} testId="teams-card">
        <form
          className="flex flex-wrap items-start gap-2 border-b border-border-subtle px-4 py-3 sm:px-5"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Input
              aria-label="New team name"
              placeholder="New team name, e.g. Enterprise Sales"
              value={newName}
              maxLength={120}
              invalid={Boolean(nameError)}
              aria-describedby={nameError ? 'team-name-error' : undefined}
              onChange={(event) => {
                setNewName(event.target.value);
                setNameError(null);
              }}
              data-testid="team-new-name"
            />
            {nameError ? (
              <p id="team-name-error" role="alert" className="text-sm text-danger-text">
                {nameError}
              </p>
            ) : null}
          </div>
          <Button type="submit" leadingIcon={<Plus aria-hidden />} loading={mutations.create.isPending} data-testid="team-create">
            Create team
          </Button>
        </form>
        {teams.isPending || members.isPending ? (
          <TableSkeleton rows={4} columns={2} />
        ) : teams.isError ? (
          <ErrorPanel title="Couldn't load teams" onRetry={() => void teams.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            size="sm"
            illustration="workspace"
            title="No teams yet"
            description="Create your first team above."
          />
        ) : (
          <div className="grid lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
            <ul aria-label="Teams" className="border-b border-border-subtle p-2 lg:border-r lg:border-b-0">
              {list.map((team) => (
                <li key={team.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(team.id)}
                    aria-current={team.id === selected?.id ? 'true' : undefined}
                    data-testid="team-row"
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors duration-[var(--duration-instant)]',
                      'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus',
                      team.id === selected?.id ? 'bg-primary-selected' : 'hover:bg-hover active:bg-pressed',
                    )}
                  >
                    <Avatar name={team.name} shape="square" size="md" />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate font-medium', team.id === selected?.id ? 'text-primary-text' : 'text-fg')}>
                        {team.name}
                      </span>
                      <span className="block text-sm text-fg-muted">{pluralize(team.memberIds.length, 'member')}</span>
                    </span>
                    <AvatarGroup
                      size="sm"
                      max={3}
                      className="shrink-0 -space-x-1"
                      people={team.memberIds
                        .map((id) => memberById.get(id))
                        .filter((entry): entry is MemberDto => Boolean(entry))
                        .map((entry) => ({ id: entry.userId, name: entry.name, src: entry.image }))}
                    />
                  </button>
                </li>
              ))}
            </ul>
            {selected ? (
              <TeamDetail
                key={selected.id}
                team={selected}
                members={members.data ?? []}
                ownerIds={owners[selected.id] ?? []}
                onDeleted={() => setSelectedId(null)}
              />
            ) : null}
          </div>
        )}
      </SettingsCard>
    </>
  );
}

function TeamDetail({
  team,
  members,
  ownerIds,
  onDeleted,
}: {
  readonly team: TeamDto;
  readonly members: readonly MemberDto[];
  readonly ownerIds: readonly string[];
  readonly onDeleted: () => void;
}) {
  const mutations = useTeamMutations();
  const setOwners = useSetTeamOwners();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(team.name);
  const [adding, setAdding] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inTeam = members.filter((entry) => team.memberIds.includes(entry.userId));
  const candidates = members.filter((entry) => !team.memberIds.includes(entry.userId));

  const saveName = () => {
    const next = name.trim();
    setRenaming(false);
    if (!next || next === team.name) {
      setName(team.name);
      return;
    }
    mutations.rename.mutate(
      { teamId: team.id, name: next },
      { onSuccess: () => toast.success('Team renamed'), onError: () => setName(team.name) },
    );
  };

  const toggleOwner = (userId: string) => {
    const next = ownerIds.includes(userId) ? ownerIds.filter((id) => id !== userId) : [...ownerIds, userId];
    setOwners.mutate({ teamId: team.id, userIds: next });
  };

  const removeMember = (entry: MemberDto) => {
    mutations.removeMembers.mutate(
      { teamId: team.id, userIds: [entry.userId] },
      {
        onSuccess: () => {
          if (ownerIds.includes(entry.userId)) setOwners.mutate({ teamId: team.id, userIds: ownerIds.filter((id) => id !== entry.userId) });
          toast.undo(`${entry.name} removed from ${team.name}`, {
            onUndo: () => mutations.addMembers.mutateAsync({ teamId: team.id, userIds: [entry.userId] }).then(() => undefined),
          });
        },
      },
    );
  };

  return (
    <div className="flex min-w-0 flex-col" data-testid="team-detail">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-5 py-4">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary-subtle text-primary-text">
          <UsersRound aria-hidden className="size-5" />
        </span>
        {renaming ? (
          <Input
            autoFocus
            aria-label="Team name"
            value={name}
            maxLength={120}
            containerClassName="max-w-xs"
            onChange={(event) => setName(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveName();
              if (event.key === 'Escape') {
                setName(team.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setRenaming(true)}
            className="group inline-flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-lg font-semibold text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span className="truncate">{team.name}</span>
            <Pencil aria-hidden className="size-3.5 text-icon opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            <span className="sr-only">Rename team</span>
          </button>
        )}
        <Badge>{pluralize(team.memberIds.length, 'member')}</Badge>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Team options" icon={<MoreHorizontal aria-hidden />} size="sm" className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={() => setRenaming(true)}>
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Trash2 aria-hidden />} variant="danger" onSelect={() => setConfirmDelete(true)}>
              Delete team…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-5 py-3">
        <Combobox
          multiple
          aria-label="Add members"
          className="min-w-0 flex-1 sm:max-w-sm"
          placeholder="Add people to this team"
          searchPlaceholder="Search people"
          emptyMessage="Everyone is already in this team"
          value={adding}
          onValueChange={setAdding}
          options={candidates.map((entry) => ({ value: entry.userId, label: entry.name, description: entry.email, keywords: [entry.email] }))}
        />
        <Button
          variant="secondary"
          disabled={adding.length === 0}
          loading={mutations.addMembers.isPending}
          onClick={() =>
            mutations.addMembers.mutate(
              { teamId: team.id, userIds: adding },
              {
                onSuccess: () => {
                  toast.success(`${pluralize(adding.length, 'person', 'people')} added to ${team.name}`);
                  setAdding([]);
                },
              },
            )
          }
          data-testid="team-add-members"
        >
          Add
        </Button>
      </div>
      {inTeam.length === 0 ? (
        <EmptyState size="sm" illustration="workspace" title="No members yet" description="Add people above." />
      ) : (
        <ul aria-label={`Members of ${team.name}`} className="divide-y divide-border-subtle">
          {inTeam.map((entry) => {
            const isOwner = ownerIds.includes(entry.userId);
            return (
              <li key={entry.userId} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-hover">
                <Avatar name={entry.name} src={entry.image} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-fg">{entry.name}</span>
                    {isOwner ? (
                      <Badge tone="primary" icon={<Crown aria-hidden />}>
                        Owner
                      </Badge>
                    ) : null}
                  </span>
                  <span className="block truncate text-sm text-fg-muted">{entry.title ?? entry.email}</span>
                </span>
                <Tooltip content={isOwner ? 'Remove as team owner' : 'Make team owner'}>
                  <Button
                    size="sm"
                    variant="ghost"
                    pressed={isOwner}
                    leadingIcon={<Crown aria-hidden />}
                    onClick={() => toggleOwner(entry.userId)}
                    aria-label={isOwner ? `Remove ${entry.name} as owner` : `Make ${entry.name} an owner`}
                  >
                    <span className="hidden sm:inline">{isOwner ? 'Owner' : 'Make owner'}</span>
                  </Button>
                </Tooltip>
                <IconButton label={`Remove ${entry.name} from team`} icon={<UserMinus aria-hidden />} size="sm" onClick={() => removeMember(entry)} />
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        destructive
        title={`Delete “${team.name}”?`}
        description="Members keep their accounts and access; only the team grouping is removed. This can’t be undone."
        confirmLabel="Delete team"
        loading={mutations.remove.isPending}
        onConfirm={() =>
          mutations.remove.mutate(team.id, {
            onSuccess: () => {
              setConfirmDelete(false);
              toast.success('Team deleted');
              onDeleted();
            },
          })
        }
      />
    </div>
  );
}
