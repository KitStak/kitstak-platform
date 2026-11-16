'use client';
/** Settings → Workspace: the org at a glance and the spaces (teams/departments) that group projects. */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FolderKanban, MoreHorizontal, Pencil, Plus, Trash2, Users } from 'lucide-react';
import {
  Avatar,
  AvatarGroup,
  Button,
  ColorPicker,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  Textarea,
  cn,
  toLabelColor,
  toast,
  type LabelColor,
} from '@/components/ui';
import { ENTITY_ICON_NAMES, EntityIcon } from '@/components/pm';
import { Panel } from '@/components/layout/page';
import { usePeople } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { SpaceDTO } from '@/lib/types';
import { createSpaceAction, deleteSpaceAction, updateSpaceAction } from '@/server/actions/spaces';
import { useShell } from '@/features/shell/shell-context';

interface SpaceDraft {
  readonly id?: string;
  readonly name: string;
  readonly description: string;
  readonly color: LabelColor;
  readonly icon: string;
}

const SPACE_ICONS = ENTITY_ICON_NAMES.slice(0, 24);

function SpaceDialog({
  draft,
  onOpenChange,
  onSaved,
}: {
  readonly draft: SpaceDraft | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: () => void;
}) {
  const [value, setValue] = useState<SpaceDraft | null>(draft);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(draft);
  if (loaded !== draft) {
    setLoaded(draft);
    setValue(draft);
    setError(null);
  }
  if (!value) return null;
  const save = async () => {
    if (!value.name.trim()) {
      setError('Give the space a name.');
      return;
    }
    setSaving(true);
    const body = {
      name: value.name.trim(),
      description: value.description.trim() || null,
      color: value.color,
      icon: value.icon,
    };
    const result = value.id
      ? await updateSpaceAction({ spaceId: value.id, patch: body })
      : await createSpaceAction(body);
    setSaving(false);
    if (!result.ok) {
      setError(result.error.fields?.name ?? null);
      toast.error("Couldn't save the space", result.error.message);
      return;
    }
    toast.success(
      value.id ? 'Space saved' : 'Space added',
      value.id ? undefined : 'Pick it when you make a project, or move projects into it from their settings.',
    );
    onSaved();
    onOpenChange(false);
  };
  return (
    <Dialog open={Boolean(draft)} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="space-dialog">
        <DialogHeader
          icon={<EntityIcon icon={value.icon} color={value.color} size={36} />}
          title={value.id ? 'Edit space' : 'New space'}
        />
        <DialogBody className="flex flex-col gap-4 pb-4">
          <Field label="Name" required error={error ?? undefined}>
            {({ inputId, invalid }) => (
              <Input
                id={inputId}
                value={value.name}
                maxLength={80}
                invalid={invalid}
                onChange={(e) => setValue({ ...value, name: e.target.value })}
                placeholder="Operations"
                data-testid="space-name"
              />
            )}
          </Field>
          <Field label="What happens here?">
            {({ inputId }) => (
              <Textarea
                id={inputId}
                rows={2}
                maxLength={1000}
                value={value.description}
                onChange={(e) => setValue({ ...value, description: e.target.value })}
                placeholder="Warehouse projects, go-lives and process changes."
              />
            )}
          </Field>
          <Field label="Color">
            {() => (
              <ColorPicker
                value={value.color}
                onChange={(color) => setValue({ ...value, color })}
                label="Space color"
              />
            )}
          </Field>
          <Field label="Icon">
            {() => (
              <div className="grid grid-cols-8 gap-1.5" role="radiogroup" aria-label="Space icon">
                {SPACE_ICONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    role="radio"
                    aria-checked={value.icon === icon}
                    aria-label={icon.replace(/-/g, ' ')}
                    onClick={() => setValue({ ...value, icon })}
                    className={cn(
                      'inline-flex size-9 items-center justify-center rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-focus',
                      value.icon === icon
                        ? 'border-primary bg-primary-subtle'
                        : 'border-transparent hover:bg-hover',
                    )}
                  >
                    <EntityIcon icon={icon} color={value.color} size={24} variant="plain" />
                  </button>
                ))}
              </div>
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving} data-testid="space-save">
            {value.id ? 'Save' : 'Add space'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceSection({ spaces }: { readonly spaces: readonly SpaceDTO[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { org, orgRole, appUrls, can } = useShell();
  const people = usePeople();
  const [editing, setEditing] = useState<SpaceDraft | null>(null);
  const [deleting, setDeleting] = useState<SpaceDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = can('space:manage');
  const refresh = () => {
    router.refresh();
    void queryClient.invalidateQueries({ queryKey: qk.spaces() });
    void queryClient.invalidateQueries({ queryKey: qk.projects() });
  };
  const members = people.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Workspace">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar name={org.name} src={org.logo} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-fg">{org.name}</p>
            <p className="text-sm text-fg-muted">
              {members.length ? `${members.length} ${members.length === 1 ? 'person' : 'people'}` : 'People'}{' '}
              · You’re{' '}
              {orgRole === 'admin' ? 'an admin' : `${/^[aeiou]/.test(orgRole) ? 'an' : 'a'} ${orgRole}`}
            </p>
          </div>
          {members.length ? (
            <AvatarGroup
              people={members.map((p) => ({ id: p.id, name: p.name, src: p.image }))}
              max={5}
              size="sm"
            />
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={`${appUrls.portal}/settings/organization`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-input bg-panel px-3 text-sm font-medium text-fg hover:bg-muted"
          >
            <Users aria-hidden className="size-4" /> Invite or manage people{' '}
            <ExternalLink aria-hidden className="size-3.5 text-icon" />
          </a>
          <a
            href={`${appUrls.portal}/billing`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg"
          >
            Plan and billing <ExternalLink aria-hidden className="size-3.5 text-icon" />
          </a>
        </div>
      </Panel>

      <Panel
        title="Spaces"
        action={
          canManage ? (
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Plus aria-hidden />}
              onClick={() => setEditing({ name: '', description: '', color: 'blue', icon: 'folder' })}
              data-testid="space-new"
            >
              New space
            </Button>
          ) : null
        }
        bodyClassName="p-0"
      >
        {spaces.length === 0 ? (
          <EmptyState
            size="sm"
            visual={<FolderKanban aria-hidden className="size-10 text-icon" />}
            title="No spaces yet"
            description="Make one per team or department."
            actions={
              canManage ? (
                <Button
                  size="sm"
                  leadingIcon={<Plus aria-hidden />}
                  onClick={() => setEditing({ name: '', description: '', color: 'blue', icon: 'folder' })}
                >
                  Add a space
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y divide-border-subtle" data-testid="space-list">
            {spaces.map((space) => (
              <li key={space.id} className="flex items-center gap-3 px-4 py-3">
                <EntityIcon icon={space.icon} color={space.color} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{space.name}</p>
                  <p className="truncate text-xs text-fg-muted">
                    {space.description || 'No description yet'}
                  </p>
                </div>
                <Link
                  href={routes.space(space.id)}
                  className="shrink-0 text-xs text-fg-secondary tabular-nums hover:text-fg hover:underline"
                >
                  {space.projectCount} {space.projectCount === 1 ? 'project' : 'projects'}
                </Link>
                {canManage ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        size="sm"
                        label={`More for ${space.name}`}
                        icon={<MoreHorizontal aria-hidden />}
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        icon={<Pencil aria-hidden />}
                        onSelect={() =>
                          setEditing({
                            id: space.id,
                            name: space.name,
                            description: space.description ?? '',
                            color: toLabelColor(space.color, 'blue'),
                            icon: space.icon,
                          })
                        }
                      >
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        icon={<Trash2 aria-hidden />}
                        variant="danger"
                        onSelect={() => setDeleting(space)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <SpaceDialog draft={editing} onOpenChange={(open) => !open && setEditing(null)} onSaved={refresh} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete “${deleting?.name ?? ''}”?`}
        description={
          deleting?.projectCount
            ? `Its ${deleting.projectCount} ${deleting.projectCount === 1 ? 'project stays' : 'projects stay'} and move to “Other projects” in the sidebar.`
            : 'There are no projects in it.'
        }
        confirmLabel="Delete space"
        destructive
        loading={busy}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          const result = await deleteSpaceAction({ spaceId: deleting.id });
          setBusy(false);
          if (!result.ok) toast.error("Couldn't delete the space", result.error.message);
          else toast.success(`Deleted ${deleting.name}`, 'Its projects were kept.');
          setDeleting(null);
          refresh();
        }}
      />
    </div>
  );
}
