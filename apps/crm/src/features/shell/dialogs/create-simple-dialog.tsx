'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { FolderPlus, LayoutDashboard, Layers } from 'lucide-react';
import {
  Button,
  ColorPicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  Input,
  ToggleGroup,
  toast,
  type LabelColor,
} from '@/components/ui';
import { useCreateDashboard, useCreateFolder, useCreateWorkspace } from '../api';
import { useOrg } from '../org-context';
import { routes } from '../routes';
import { useShellStore } from '../store';

const NAME_MAX = 120;
const WORKSPACE_COLORS: readonly LabelColor[] = [
  'blue',
  'purple',
  'teal',
  'green',
  'orange',
  'pink',
  'indigo',
  'berry',
  'sky',
  'peach',
];

export type SimpleCreateKind = 'dashboard' | 'folder' | 'workspace';

const COPY: Readonly<
  Record<
    SimpleCreateKind,
    { title: string; description: string; label: string; placeholder: string; cta: string }
  >
> = {
  dashboard: {
    title: 'Create dashboard',
    description: 'Combine charts, numbers and tables from your boards.',
    label: 'Dashboard name',
    placeholder: 'e.g. Revenue overview',
    cta: 'Create dashboard',
  },
  folder: {
    title: 'Create folder',
    description: 'Group related boards and dashboards together.',
    label: 'Folder name',
    placeholder: 'e.g. Enterprise accounts',
    cta: 'Create folder',
  },
  workspace: {
    title: 'Create workspace',
    description: 'Workspaces separate teams, regions or business lines.',
    label: 'Workspace name',
    placeholder: 'e.g. EMEA Sales',
    cta: 'Create workspace',
  },
};

const ICONS = { dashboard: LayoutDashboard, folder: FolderPlus, workspace: Layers } as const;

export interface CreateSimpleDialogProps {
  readonly kind: SimpleCreateKind;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workspaceId?: string;
  readonly parentFolderId?: string | null;
}

/** Name (+ color / access for workspaces) dialog for dashboards, folders and workspaces. */
export function CreateSimpleDialog({
  kind,
  open,
  onOpenChange,
  workspaceId,
  parentFolderId,
}: CreateSimpleDialogProps) {
  const router = useRouter();
  const { org } = useOrg();
  const setActiveWorkspace = useShellStore((state) => state.setActiveWorkspace);
  const expandFolders = useShellStore((state) => state.expandFolders);
  const createFolder = useCreateFolder(org.id);
  const createDashboard = useCreateDashboard(org.id);
  const createWorkspace = useCreateWorkspace(org.id);
  const [name, setName] = useState('');
  const [color, setColor] = useState<LabelColor>('blue');
  const [access, setAccess] = useState<'open' | 'closed'>('open');
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[kind];
  const Icon = ICONS[kind];
  const trimmed = name.trim();
  const nameError = trimmed.length > NAME_MAX ? `Use ${NAME_MAX} characters or fewer.` : null;
  const pending = createFolder.isPending || createDashboard.isPending || createWorkspace.isPending;

  const close = () => {
    onOpenChange(false);
    setName('');
    setError(null);
  };
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : 'Something went wrong.');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed || nameError || pending) return;
    setError(null);
    if (kind === 'workspace') {
      createWorkspace.mutate(
        { name: trimmed, color, kind: access },
        {
          onSuccess: (workspace) => {
            setActiveWorkspace(org.id, workspace.id);
            toast.success(`Workspace “${workspace.name}” created`);
            close();
          },
          onError: fail,
        },
      );
      return;
    }
    if (!workspaceId) {
      setError('Choose a workspace first.');
      return;
    }
    if (kind === 'folder') {
      createFolder.mutate(
        { workspaceId, parentId: parentFolderId ?? null, name: trimmed },
        {
          onSuccess: (folder) => {
            expandFolders([folder.id, ...(parentFolderId ? [parentFolderId] : [])]);
            toast.success(`Folder “${folder.name}” created`);
            close();
          },
          onError: fail,
        },
      );
      return;
    }
    createDashboard.mutate(
      { workspaceId, name: trimmed },
      {
        onSuccess: (dashboard) => {
          toast.success(`Dashboard “${dashboard.name}” created`);
          close();
          router.push(routes.dashboard(org.slug, dashboard.id));
        },
        onError: fail,
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? onOpenChange(true) : close())}>
      <DialogContent size="sm">
        <DialogHeader
          title={copy.title}
          description={copy.description}
          icon={
            <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary-subtle text-primary-text">
              <Icon aria-hidden className="size-[18px]" />
            </span>
          }
        />
        <form onSubmit={submit} className="contents">
          <DialogBody className="flex flex-col gap-4 pb-4">
            <Field label={copy.label} required error={nameError}>
              {({ inputId, describedBy, invalid }) => (
                <Input
                  id={inputId}
                  size="lg"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={copy.placeholder}
                  aria-describedby={describedBy}
                  invalid={invalid}
                />
              )}
            </Field>
            {kind === 'workspace' ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold text-fg-secondary">Color</span>
                  <ColorPicker
                    value={color}
                    onChange={setColor}
                    colors={WORKSPACE_COLORS}
                    columns={10}
                    label="Workspace color"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold text-fg-secondary">Access</span>
                  <ToggleGroup
                    label="Workspace access"
                    value={access}
                    onValueChange={setAccess}
                    options={[
                      { value: 'open', label: 'Open to the organization' },
                      { value: 'closed', label: 'Closed (invite only)' },
                    ]}
                  />
                </div>
              </>
            ) : null}
            {error ? (
              <p role="alert" className="rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger-text">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed || Boolean(nameError)} loading={pending}>
              {copy.cta}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
