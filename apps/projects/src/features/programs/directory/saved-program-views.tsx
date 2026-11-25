'use client';
/**
 * Saved views for the Programs directory (docs/programs/SPEC.md 5.3): "All programs" plus views
 * stored as `pm.saved_views` with no project and `surface = 'programs'`. Save view, Save as new,
 * Rename, Set as my default, Share with workspace (editors) and Delete with Undo.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bookmark, BookmarkPlus, Check, ChevronDown, Pencil, Save, Star, Trash2, Users } from 'lucide-react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Input,
  toast,
} from '@/components/ui';
import type { SavedViewDTO } from '@/lib/types';
import { createSavedViewAction, deleteSavedViewAction, updateSavedViewAction } from '@/server/actions/views';
import type { DirectoryFilters, DirectoryPrefs } from './directory-model';

export interface SavedProgramViewsProps {
  readonly views: readonly SavedViewDTO[];
  readonly activeId: string | null;
  readonly filters: DirectoryFilters;
  readonly prefs: DirectoryPrefs;
  readonly canShare: boolean;
  readonly onApply: (view: SavedViewDTO | null) => void;
}

function configOf(filters: DirectoryFilters, prefs: DirectoryPrefs): Record<string, unknown> {
  return { filters, prefs };
}

export function SavedProgramViews({ views, activeId, filters, prefs, canShare, onApply }: SavedProgramViewsProps) {
  const router = useRouter();
  const active = views.find((view) => view.id === activeId) ?? null;
  const [dialog, setDialog] = useState<'new' | 'rename' | null>(null);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (mode: 'new' | 'rename') => {
    setName(mode === 'rename' ? (active?.name ?? '') : '');
    setShared(false);
    setError(null);
    setDialog(mode);
  };

  const create = async (input: { name: string; shared: boolean; isDefault?: boolean }) => {
    const result = await createSavedViewAction({ projectId: null, name: input.name, type: 'table', config: configOf(filters, prefs), shared: input.shared, isDefault: input.isDefault, surface: 'programs' });
    if (!result.ok) {
      setError(result.error.message);
      toast.error("Couldn't save the view", result.error.message);
      return null;
    }
    router.refresh();
    return result.data as SavedViewDTO;
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name the view, like "Gripwell programs".');
      return;
    }
    setPending(true);
    if (dialog === 'rename' && active) {
      const result = await updateSavedViewAction({ viewId: active.id, patch: { name: trimmed } });
      setPending(false);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success('View renamed');
      router.refresh();
      setDialog(null);
      return;
    }
    const view = await create({ name: trimmed, shared });
    setPending(false);
    if (view) {
      toast.success(`Saved the view ${trimmed}`, shared ? 'Everyone in the workspace can pick it.' : 'Only you can see it.');
      onApply(view);
      setDialog(null);
    }
  };

  const saveCurrent = async () => {
    if (!active) return;
    const result = await updateSavedViewAction({ viewId: active.id, patch: { config: configOf(filters, prefs) } });
    if (!result.ok) {
      toast.error("Couldn't save the view", result.error.message);
      return;
    }
    toast.success(`Saved ${active.name}`);
    router.refresh();
  };

  const makeDefault = async () => {
    if (!active) return;
    const result = await updateSavedViewAction({ viewId: active.id, patch: { isDefault: !active.isDefault } });
    if (!result.ok) {
      toast.error("Couldn't change your default view", result.error.message);
      return;
    }
    toast.success(active.isDefault ? 'All programs opens first again' : `${active.name} opens first for you`);
    router.refresh();
  };

  const share = async () => {
    if (!active) return;
    const copy = await create({ name: active.name, shared: true, isDefault: false });
    if (!copy) return;
    await deleteSavedViewAction({ viewId: active.id });
    toast.success(`Shared ${active.name}`, 'Everyone in the workspace can pick it now.');
    onApply(copy);
  };

  const remove = async () => {
    if (!active) return;
    const removed = active;
    const result = await deleteSavedViewAction({ viewId: removed.id });
    if (!result.ok) {
      toast.error("Couldn't delete the view", result.error.message);
      return;
    }
    onApply(null);
    router.refresh();
    toast.undo(`Deleted the view ${removed.name}`, {
      onUndo: async () => {
        const back = await createSavedViewAction({ projectId: null, name: removed.name, type: 'table', config: removed.config as unknown as Record<string, unknown>, shared: removed.userId === null, isDefault: removed.isDefault, surface: 'programs' });
        if (!back.ok) throw new Error(back.error.message);
        router.refresh();
      },
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" leadingIcon={<Bookmark aria-hidden />} trailingIcon={<ChevronDown aria-hidden />} data-testid="programs-views">
            <span className="max-w-[160px] truncate">{active?.name ?? 'All programs'}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Views</DropdownMenuLabel>
          <DropdownMenuItem icon={active ? <span className="size-4" /> : <Check aria-hidden />} onSelect={() => onApply(null)}>
            All programs
          </DropdownMenuItem>
          {views.map((view) => (
            <DropdownMenuItem key={view.id} icon={view.id === activeId ? <Check aria-hidden /> : view.userId === null ? <Users aria-hidden /> : <Bookmark aria-hidden />} description={[view.userId === null ? 'Shared with the workspace' : 'Only you', view.isDefault ? 'Opens first' : null].filter(Boolean).join(' · ')} onSelect={() => onApply(view)}>
              {view.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>This view</DropdownMenuLabel>
          {active ? <DropdownMenuItem icon={<Save aria-hidden />} description="Keep the filters, layout and sort you see" onSelect={() => void saveCurrent()}>Save view</DropdownMenuItem> : null}
          <DropdownMenuItem icon={<BookmarkPlus aria-hidden />} onSelect={() => open('new')}>Save as new</DropdownMenuItem>
          {active ? (
            <>
              <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={() => open('rename')}>Rename</DropdownMenuItem>
              <DropdownMenuItem icon={<Star aria-hidden />} onSelect={() => void makeDefault()}>{active.isDefault ? 'Stop opening it first' : 'Set as my default'}</DropdownMenuItem>
              {canShare && active.userId !== null ? <DropdownMenuItem icon={<Users aria-hidden />} onSelect={() => void share()}>Share with workspace</DropdownMenuItem> : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Trash2 aria-hidden />} variant="danger" onSelect={() => void remove()}>Delete view</DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={dialog !== null} onOpenChange={(next) => (next ? null : setDialog(null))}>
        <DialogContent size="sm">
          <DialogHeader title={dialog === 'rename' ? 'Rename view' : 'Save this view'} description={dialog === 'rename' ? undefined : 'Saves your filters, layout and sort so you can come back in one click.'} />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <DialogBody className="flex flex-col gap-4">
              <Field label="View name" required error={error}>
                {({ inputId, invalid }) => <Input id={inputId} value={name} invalid={invalid} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus />}
              </Field>
              {dialog === 'new' && canShare ? (
                <label className="flex items-center gap-2 text-sm text-fg">
                  <Checkbox checked={shared} onCheckedChange={(checked) => setShared(checked === true)} />
                  Share with the workspace
                </label>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" loading={pending}>{dialog === 'rename' ? 'Rename' : 'Save view'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
