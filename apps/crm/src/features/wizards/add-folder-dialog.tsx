'use client';
/** Add folder: name, color and parent (workspace root or another folder). */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Folder } from 'lucide-react';
import {
  Button,
  ColorPicker,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  Input,
  Select,
  Skeleton,
  toast,
  type LabelColor,
} from '@/components/ui';
import { useWorkspaceTree, useWorkspaces } from '@/features/shell/api';
import { describeError, useCreateWizardFolder, type DescribedError } from './api';
import { useOrg } from '@/features/shell/org-context';
import { useShellStore } from '@/features/shell/store';
import { GuardedDialog, InlineError, preventEscape } from './components/primitives';

const NAME_MAX = 120;
const FOLDER_COLORS: readonly LabelColor[] = [
  'gray', 'blue', 'dark-blue', 'indigo', 'purple', 'pink', 'berry', 'red',
  'peach', 'orange', 'yellow', 'lime', 'green', 'teal', 'sky', 'brown',
];

export interface AddFolderDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly workspaceId?: string;
  readonly parentFolderId?: string | null;
}

export function AddFolderDialog({ open, onClose, workspaceId, parentFolderId = null }: AddFolderDialogProps) {
  const { org } = useOrg();
  const expandFolders = useShellStore((state) => state.expandFolders);
  const workspaces = useWorkspaces(org.id);
  const [workspace, setWorkspace] = useState<string | null>(workspaceId ?? null);
  const effectiveWorkspace = workspace ?? workspaces.data?.[0]?.id ?? null;
  const tree = useWorkspaceTree(org.id, effectiveWorkspace);
  const create = useCreateWizardFolder(org.id);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState<LabelColor>('gray');
  const [parent, setParent] = useState<string>(parentFolderId ?? 'root');
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<DescribedError | null>(null);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (open) window.setTimeout(() => nameRef.current?.focus(), 0);
  }, [open]);

  const parentOptions = useMemo(() => {
    const folders = tree.data?.folders ?? [];
    const depth = (id: string | null, guard = 0): number => {
      const folder = folders.find((item) => item.id === id);
      return folder?.parentId && guard < 8 ? 1 + depth(folder.parentId, guard + 1) : 0;
    };
    return [
      { value: 'root', label: 'Workspace root' },
      ...folders.map((folder) => ({
        value: folder.id,
        label: `${'  '.repeat(depth(folder.id))}${depth(folder.id) ? '↳ ' : ''}${folder.name}`,
      })),
    ];
  }, [tree.data]);

  const dirty = Boolean(name.trim()) || color !== 'gray';

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (create.isPending) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > NAME_MAX) {
      setNameError(trimmed ? `Use ${NAME_MAX} characters or fewer.` : 'Give your folder a name.');
      nameRef.current?.focus();
      return;
    }
    if (!effectiveWorkspace) {
      if (!workspaces.isLoading) {
        setError({ message: 'Choose a workspace for the folder.', retryable: false });
        return;
      }
      // Submitted before the workspace list arrived: finish as soon as it does.
      setWaiting(true);
      void workspaces.refetch().then((result) => {
        setWaiting(false);
        const first = result.data?.[0]?.id;
        if (first) createIn(first, trimmed);
        else setError({ message: 'We couldn’t load your workspaces. Check your connection.', retryable: true });
      });
      return;
    }
    createIn(effectiveWorkspace, trimmed);
  };

  const createIn = (workspaceId: string, trimmed: string) => {
    setError(null);
    const parentId = parent === 'root' ? null : parent;
    create.mutate(
      { workspaceId, parentId, name: trimmed, color },
      {
        onSuccess: (folder) => {
          expandFolders([folder.id, ...(parentId ? [parentId] : [])]);
          toast.success(`Folder “${folder.name}” created`, 'Drag boards into it from the sidebar.');
          onClose();
        },
        onError: (cause) => {
          const described = describeError(cause);
          setError(described);
        },
      },
    );
  };

  return (
    <GuardedDialog open={open} onOpenChange={(next) => !next && onClose()} dirty={dirty} locked={create.isPending}>
      {(requestClose) => (
        <DialogContent size="sm" data-testid="add-folder-dialog" onEscapeKeyDown={preventEscape}>
          <DialogHeader
            title="Create folder"
            icon={<Folder aria-hidden className="size-6" style={{ color: `var(--label-${color}-text)` }} />}
          />
          <form noValidate onSubmit={submit} className="contents">
            <DialogBody className="flex flex-col gap-5 pb-4">
              <Field label="Folder name" required error={nameError}>
                {({ inputId, describedBy, invalid }) => (
                  <Input
                    ref={nameRef}
                    id={inputId}
                    size="lg"
                    data-testid="folder-name-input"
                    value={name}
                    maxLength={NAME_MAX}
                    placeholder="e.g. Enterprise deals"
                    onChange={(event) => {
                      setName(event.target.value);
                      if (nameError) setNameError(null);
                    }}
                    aria-describedby={describedBy}
                    invalid={invalid}
                  />
                )}
              </Field>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-fg-secondary">Color</legend>
                <ColorPicker value={color} onChange={setColor} colors={FOLDER_COLORS} columns={8} label="Folder color" />
              </fieldset>
              {!workspaceId ? (
                <Field label="Workspace">
                  {({ inputId }) =>
                    workspaces.isLoading ? (
                      <Skeleton height={40} className="w-full" />
                    ) : (
                      <Select
                        id={inputId}
                        size="lg"
                        value={effectiveWorkspace ?? undefined}
                        onValueChange={(value) => {
                          setWorkspace(value);
                          setParent('root');
                        }}
                        options={(workspaces.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
                      />
                    )
                  }
                </Field>
              ) : null}
              <Field label="Location">
                {({ inputId }) =>
                  tree.isLoading || workspaces.isLoading ? (
                    <Skeleton height={40} className="w-full" />
                  ) : (
                    <Select id={inputId} size="lg" value={parent} onValueChange={setParent} options={parentOptions} />
                  )
                }
              </Field>
              {error ? (
                <InlineError onRetry={error.retryable ? () => submit() : undefined}>{error.message}</InlineError>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={requestClose} disabled={create.isPending}>
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending || waiting} data-testid="folder-create-submit">
                Create folder
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </GuardedDialog>
  );
}
