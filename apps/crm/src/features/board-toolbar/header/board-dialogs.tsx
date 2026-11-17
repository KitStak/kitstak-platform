'use client';

/** Duplicate board, Move board and Board settings dialogs. */
import { useId, useMemo, useState } from 'react';
import { CopyPlus, FolderInput, Settings2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  Input,
  Select,
  cn,
  toast,
} from '@/components/ui';
import { useWorkspaceTree, useWorkspaces } from '@/lib/hooks';
import type { BoardDto, ColumnDto, ViewDto } from '@/server/services/contracts/dto';
import type { BoardCommands, DuplicateMode } from '../hooks/use-board-commands';

interface BaseProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly board: BoardDto;
}

const MODES: { value: DuplicateMode; label: string; description: string }[] = [
  { value: 'structure', label: 'Structure only', description: 'Columns, groups and views. No items.' },
  { value: 'items', label: 'Structure and items', description: 'Everything on the board, without updates.' },
  { value: 'items_updates', label: 'Structure, items and updates', description: 'A full copy including the conversation.' },
];

export function DuplicateBoardDialog({ open, onOpenChange, board, commands }: BaseProps & { readonly commands: BoardCommands }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<DuplicateMode>('items');
  const groupId = useId();
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(`Copy of ${board.name}`);
      setMode('items');
    }
  }
  const submit = () =>
    void commands
      .duplicate(mode, name)
      .then(() => onOpenChange(false))
      .catch(() => undefined);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="duplicate-board-dialog">
        <DialogHeader title="Duplicate board" description="The copy goes in the same workspace." icon={<CopyPlus aria-hidden />} />
        <DialogBody className="flex flex-col gap-4">
          <Field label="New board name" required>
            {({ inputId }) => (
              <Input id={inputId} value={name} maxLength={255} onChange={(event) => setName(event.target.value)} autoFocus />
            )}
          </Field>
          <div role="radiogroup" aria-labelledby={groupId} className="flex flex-col gap-2">
            <span id={groupId} className="text-sm font-medium text-fg-secondary">
              What to copy
            </span>
            {MODES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={mode === option.value}
                onClick={() => setMode(option.value)}
                className={cn(
                  'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-[border-color,background-color] duration-[var(--duration-fast)] ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  mode === option.value ? 'border-primary bg-primary-subtle' : 'border-border-default hover:border-border-strong hover:bg-muted',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                    mode === option.value ? 'border-primary' : 'border-border-input',
                  )}
                >
                  {mode === option.value ? <span className="size-2 rounded-full bg-primary" /> : null}
                </span>
                <span>
                  <span className="block text-base font-medium text-fg">{option.label}</span>
                  <span className="block text-sm text-fg-muted">{option.description}</span>
                </span>
              </button>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} loading={commands.duplicating} disabled={!name.trim()}>
            Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MoveBoardDialog({ open, onOpenChange, board, commands }: BaseProps & { readonly commands: BoardCommands }) {
  const workspaces = useWorkspaces();
  const [workspaceId, setWorkspaceId] = useState(board.workspaceId);
  const [folderId, setFolderId] = useState<string>(board.folderId ?? '');
  const tree = useWorkspaceTree(open ? workspaceId : undefined);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setWorkspaceId(board.workspaceId);
      setFolderId(board.folderId ?? '');
    }
  }
  const folderOptions = useMemo(
    () => [{ value: '', label: 'No folder (workspace root)' }, ...(tree.data?.folders ?? []).map((folder) => ({ value: folder.id, label: folder.name }))],
    [tree.data?.folders],
  );
  const unchanged = workspaceId === board.workspaceId && (folderId || null) === board.folderId;
  const submit = () => {
    const workspace = workspaces.data?.find((entry) => entry.id === workspaceId);
    const folder = tree.data?.folders.find((entry) => entry.id === folderId);
    commands.moveTo(workspaceId, folderId || null, folder ? `${workspace?.name ?? 'workspace'} › ${folder.name}` : (workspace?.name ?? 'workspace'));
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="move-board-dialog">
        <DialogHeader title="Move board" icon={<FolderInput aria-hidden />} />
        <DialogBody className="flex flex-col gap-4">
          <Field label="Workspace">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={workspaceId}
                onValueChange={(value) => {
                  setWorkspaceId(value);
                  setFolderId('');
                }}
                options={(workspaces.data ?? []).map((workspace) => ({ value: workspace.id, label: workspace.name }))}
                placeholder={workspaces.isPending ? 'Loading workspaces…' : 'Choose a workspace'}
              />
            )}
          </Field>
          <Field label="Folder" hint={tree.isPending ? 'Loading folders…' : undefined}>
            {({ inputId }) => (
              <Select id={inputId} value={folderId} onValueChange={setFolderId} options={folderOptions} disabled={tree.isPending} />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={unchanged}>
            Move board
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface BoardSettingsDialogProps extends BaseProps {
  readonly commands: BoardCommands;
  readonly views: readonly ViewDto[];
  readonly columns: readonly ColumnDto[];
  readonly onSetDefaultView: (viewId: string) => void;
}

export function BoardSettingsDialog({ open, onOpenChange, board, commands, views, columns, onSetDefaultView }: BoardSettingsDialogProps) {
  const [terminology, setTerminology] = useState(board.itemTerminology || 'Item');
  const [description, setDescription] = useState(board.description ?? '');
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTerminology(board.itemTerminology || 'Item');
      setDescription(board.description ?? '');
    }
  }
  const defaultView = views.find((view) => view.isDefault) ?? views[0];
  const readOnly = !board.canEdit;
  const save = () => {
    const input: { itemTerminology?: string; description?: string | null } = {};
    const noun = terminology.trim();
    if (noun && noun !== board.itemTerminology) input.itemTerminology = noun;
    if (description.trim() !== (board.description ?? '')) input.description = description.trim() || null;
    if (Object.keys(input).length === 0) {
      onOpenChange(false);
      return;
    }
    commands.update.mutate(input, {
      onSuccess: () => {
        toast.success('Board settings saved');
        onOpenChange(false);
      },
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="board-settings-dialog">
        <DialogHeader title="Board settings" description={board.name} icon={<Settings2 aria-hidden />} />
        <DialogBody className="flex flex-col gap-5">
          <Field
            label="Item terminology"
            hint={`Buttons, counts and empty states say “New ${terminology.trim() || 'Item'}”.`}
          >
            {({ inputId, describedBy }) => (
              <Input
                id={inputId}
                aria-describedby={describedBy}
                value={terminology}
                maxLength={40}
                disabled={readOnly}
                onChange={(event) => setTerminology(event.target.value)}
              />
            )}
          </Field>
          <Field label="Description">
            {({ inputId }) => (
              <Input
                id={inputId}
                value={description}
                maxLength={2000}
                disabled={readOnly}
                placeholder="What is this board for?"
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </Field>
          <Field label="Default view" hint="The view everyone lands on when they open the board.">
            {({ inputId, describedBy }) => (
              <Select
                id={inputId}
                aria-describedby={describedBy}
                value={defaultView?.id}
                disabled={readOnly}
                onValueChange={onSetDefaultView}
                options={views.map((view) => ({ value: view.id, label: view.name }))}
              />
            )}
          </Field>
          <section aria-labelledby="column-permissions" className="rounded-lg border border-border-subtle bg-sunken px-4 py-3">
            <h3 id="column-permissions" className="text-base font-medium text-fg">
              Column permissions
            </h3>
            <p className="mt-1 text-sm text-fg-secondary">
              Restrict who can edit or see specific columns ({columns.filter((column) => column.type !== 'name').length} columns on
              this board). Coming soon: per-column edit and view rules by role and team.
            </p>
          </section>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{readOnly ? 'Close' : 'Cancel'}</Button>
          </DialogClose>
          {readOnly ? null : (
            <Button onClick={save} loading={commands.update.isPending} disabled={!terminology.trim()}>
              Save settings
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
