'use client';

/**
 * Invite / share: board members with roles, add people from the org, board privacy, copy link,
 * and "Invite to KitStak" for people who aren't in the org yet.
 */
import { useMemo, useState } from 'react';
import { Check, Globe2, Link2, Lock, Mail, Trash2, Users } from 'lucide-react';
import {
  Avatar,
  Button,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  IconButton,
  Select,
  cn,
  toast,
} from '@/components/ui';
import { useOpenWizard } from '@/features/wizards';
import { useSetBoardMembers, useUpdateBoard } from '@/lib/hooks';
import type { BoardDto, BoardPrivacy, BoardRole, UserSummaryDto } from '@/server/services/contracts/dto';

const ROLE_OPTIONS: { value: BoardRole; label: string; description: string }[] = [
  { value: 'owner', label: 'Owner', description: 'Manage settings, members and structure' },
  { value: 'editor', label: 'Editor', description: 'Edit items and columns' },
  { value: 'viewer', label: 'Viewer', description: 'View and comment only' },
  { value: 'subscriber', label: 'Subscriber', description: 'Gets notifications' },
];

const PRIVACY: { value: BoardPrivacy; label: string; description: string; icon: typeof Globe2 }[] = [
  { value: 'main', label: 'Main', description: 'Everyone in the workspace can see it', icon: Globe2 },
  { value: 'private', label: 'Private', description: 'Only board members can see it', icon: Lock },
  { value: 'shareable', label: 'Shareable', description: 'Members can invite guests from outside', icon: Users },
];

export interface ShareDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly board: BoardDto;
  readonly users: readonly UserSummaryDto[];
}

export function ShareDialog({ open, onOpenChange, board, users }: ShareDialogProps) {
  const setMembers = useSetBoardMembers(board.id);
  const update = useUpdateBoard(board.id);
  const wizards = useOpenWizard();
  const [pick, setPick] = useState<string | null>(null);
  const [role, setRole] = useState<BoardRole>('editor');
  const canManage = board.canEdit;
  const byId = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const memberIds = new Set(board.members.map((member) => member.userId));
  const candidates = users
    .filter((user) => !memberIds.has(user.id))
    .map((user) => ({ value: user.id, label: user.name, description: user.email, keywords: [user.email] }));

  const write = (members: { userId: string; role: BoardRole }[], message: string) =>
    setMembers.mutate({ members }, { onSuccess: () => toast.success(message) });

  const add = () => {
    if (!pick) return;
    const person = byId.get(pick);
    write([...board.members, { userId: pick, role }], `${person?.name ?? 'Member'} added as ${role}`);
    setPick(null);
  };

  const copyLink = () =>
    void navigator.clipboard
      .writeText(`${window.location.origin}${window.location.pathname}`)
      .then(() => toast.success('Board link copied'))
      .catch(() => toast.error("Couldn't copy the link"));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="share-dialog">
        <DialogHeader
          title={`Share “${board.name}”`}
          icon={<Users aria-hidden />}
        />
        <DialogBody className="flex flex-col gap-5">
          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <Combobox
                options={candidates}
                value={pick}
                onValueChange={setPick}
                placeholder="Add people by name or email"
                searchPlaceholder="Search people"
                emptyMessage="Everyone in your organization is already on this board."
                className="min-w-0 flex-1 basis-56"
              />
              <Select
                value={role}
                onValueChange={(value) => setRole(value as BoardRole)}
                options={ROLE_OPTIONS.map(({ value, label }) => ({ value, label }))}
                className="w-32"
                aria-label="Role for new member"
              />
              <Button onClick={add} disabled={!pick} loading={setMembers.isPending}>
                Add
              </Button>
            </div>
          ) : null}

          <section aria-labelledby="share-members">
            <h3 id="share-members" className="mb-2 text-sm font-semibold text-fg-secondary">
              Board members · {board.members.length}
            </h3>
            {board.members.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-default px-4 py-3 text-base text-fg-muted">
                No one is added yet. On a Main board everyone in the workspace can still see it.
              </p>
            ) : (
              <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto" data-testid="share-members">
                {board.members.map((member) => {
                  const person = byId.get(member.userId);
                  const name = person?.name ?? 'Former member';
                  return (
                    <li key={member.userId} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-hover">
                      <Avatar name={name} src={person?.image} colorKey={member.userId} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base text-fg">{name}</span>
                        <span className="block truncate text-xs text-fg-muted">{person?.email}</span>
                      </span>
                      {canManage ? (
                        <>
                          <Select
                            size="sm"
                            value={member.role}
                            onValueChange={(value) =>
                              write(
                                board.members.map((entry) =>
                                  entry.userId === member.userId ? { ...entry, role: value as BoardRole } : entry,
                                ),
                                `${name} is now ${value}`,
                              )
                            }
                            options={ROLE_OPTIONS.map(({ value, label }) => ({ value, label }))}
                            className="w-28"
                            aria-label={`Role for ${name}`}
                          />
                          <IconButton
                            label={`Remove ${name}`}
                            size="sm"
                            icon={<Trash2 aria-hidden />}
                            onClick={() =>
                              write(
                                board.members.filter((entry) => entry.userId !== member.userId),
                                `${name} removed from the board`,
                              )
                            }
                          />
                        </>
                      ) : (
                        <span className="text-sm text-fg-muted capitalize">{member.role}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="share-privacy">
            <h3 id="share-privacy" className="mb-2 text-sm font-semibold text-fg-secondary">
              Privacy
            </h3>
            <div role="radiogroup" aria-labelledby="share-privacy" className="grid gap-2 sm:grid-cols-3">
              {PRIVACY.map((option) => {
                const Icon = option.icon;
                const selected = board.privacy === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={!canManage}
                    onClick={() =>
                      update.mutate(
                        { privacy: option.value },
                        { onSuccess: () => toast.success(`Board is now ${option.label.toLowerCase()}`) },
                      )
                    }
                    className={cn(
                      'relative flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-[border-color,background-color,box-shadow] duration-[var(--duration-fast)] ease-out',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-[0.38]',
                      selected
                        ? 'border-primary bg-primary-subtle shadow-xs'
                        : 'border-border-default bg-panel hover:border-border-strong hover:bg-muted',
                    )}
                  >
                    <span className="flex w-full items-center gap-1.5 text-base font-medium text-fg">
                      <Icon aria-hidden className="size-4 text-icon" />
                      {option.label}
                      {selected ? <Check aria-hidden className="ml-auto size-4 text-primary-text" /> : null}
                    </span>
                    <span className="text-xs text-fg-muted">{option.description}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </DialogBody>
        <DialogFooter className="justify-between">
          <Button variant="ghost" leadingIcon={<Link2 />} onClick={copyLink}>
            Copy link
          </Button>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              leadingIcon={<Mail />}
              onClick={() => {
                onOpenChange(false);
                wizards.invite();
              }}
            >
              Invite to KitStak
            </Button>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
