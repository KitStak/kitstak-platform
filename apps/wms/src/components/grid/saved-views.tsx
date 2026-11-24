'use client';

/**
 * Saved views (BUILD_PLAN F4.3): Save view dialog with "Create New" or "Overwrite"
 * an existing view, Share and Set as default; a Views menu to apply, set default,
 * share/unshare and delete.
 */
import * as React from 'react';
import { Bookmark, BookmarkPlus, Check, Share2, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RadioCards } from '@/components/ui/radio-cards';
import { Select } from '@/components/ui/select';
import { TextField } from '@/components/ui/text-field';
import { DisabledReason, Tooltip } from '@/components/ui/tooltip';
import { SAVED_VIEW_NAME_MAX, validateViewName, type SavedView, type useSavedViews } from './use-saved-views';

type SavedViewsApi = ReturnType<typeof useSavedViews>;
type SaveMode = 'new' | 'overwrite';

export interface SavedViewsProps {
  readonly api: SavedViewsApi;
  /** Current canonical grid query string (without paging is fine). */
  readonly query: string;
  readonly activeViewId?: string | null;
  readonly onApply: (view: SavedView) => void;
}

function SaveViewDialog({
  open,
  onOpenChange,
  api,
  query,
  activeViewId,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly api: SavedViewsApi;
  readonly query: string;
  readonly activeViewId?: string | null;
}) {
  const ownViews = api.views.filter((v) => v.isOwner !== false);
  const [mode, setMode] = React.useState<SaveMode>('new');
  const [name, setName] = React.useState('');
  const [targetId, setTargetId] = React.useState<string | null>(null);
  const [isShared, setShared] = React.useState(false);
  const [isDefault, setDefault] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const active = ownViews.find((v) => v.id === activeViewId);
    // Reset the form each time the dialog opens.
    /* eslint-disable react-hooks/set-state-in-effect */
    setMode(active ? 'overwrite' : 'new');
    setTargetId(active?.id ?? null);
    setName('');
    setShared(active?.isShared ?? false);
    setDefault(active?.isDefault ?? false);
    setTouched(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open
  }, [open]);

  const nameError = mode === 'new' ? validateViewName(name, api.views) : null;
  const reason = mode === 'new' ? nameError : targetId ? null : 'Choose a view to overwrite';
  const pending = api.create.isPending || api.update.isPending;

  const submit = async () => {
    setTouched(true);
    if (reason) return;
    if (mode === 'new') await api.create.mutateAsync({ name: name.trim(), query, isShared, isDefault });
    else if (targetId) await api.update.mutateAsync({ id: targetId, query, isShared, isDefault });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-plan-read="">
        <DialogHeader
          title="Save view"
          description="Keep the current search, filters and sort as a named view."
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit().catch(() => undefined);
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <RadioCards<SaveMode>
              value={mode}
              onChange={setMode}
              options={[
                { value: 'new', title: 'Create new', description: 'Save as a new view' },
                {
                  value: 'overwrite',
                  title: 'Overwrite',
                  description: ownViews.length ? 'Replace one of your views' : 'You have no views yet',
                  disabled: ownViews.length === 0,
                },
              ]}
            />
            {mode === 'new' ? (
              <label className="flex flex-col gap-1 text-xs font-semibold text-secondary">
                <span>
                  View name <span className="text-danger">*</span>
                </span>
                <TextField
                  autoFocus
                  value={name}
                  maxLength={SAVED_VIEW_NAME_MAX}
                  showCount
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setTouched(true)}
                  invalid={touched && Boolean(nameError)}
                  aria-describedby="save-view-name-error"
                />
                {touched && nameError ? (
                  <span id="save-view-name-error" className="text-2xs font-medium text-danger">
                    {nameError}
                  </span>
                ) : null}
              </label>
            ) : (
              <label className="flex flex-col gap-1 text-xs font-semibold text-secondary">
                View to overwrite
                <Select
                  options={ownViews.map((v) => ({ value: v.id, label: v.name }))}
                  value={targetId}
                  onChange={setTargetId}
                  placeholder="Choose a view"
                  aria-label="View to overwrite"
                />
              </label>
            )}
            <div className="flex flex-col gap-2">
              <Checkbox
                label="Share with my team"
                description="Everyone with access to this list can apply it."
                checked={isShared}
                onCheckedChange={(c) => setShared(c === true)}
              />
              <Checkbox
                label="Set as my default view"
                description="Opens automatically when you visit this list."
                checked={isDefault}
                onCheckedChange={(c) => setDefault(c === true)}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <DisabledReason reason={pending ? 'Saving…' : reason}>
              <Button type="submit" variant="primary" disabled={pending || Boolean(reason)}>
                Save
              </Button>
            </DisabledReason>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Inline "Save filter" icon button beside the applied chips (Logiwa parity). */
export function SaveFilterButton({ api, query, activeViewId }: Omit<SavedViewsProps, 'onApply'>) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Tooltip content="Save filter as a view">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Save filter"
          onClick={() => setOpen(true)}
          className="shrink-0"
        >
          <BookmarkPlus className="h-4 w-4" aria-hidden />
        </Button>
      </Tooltip>
      <SaveViewDialog
        open={open}
        onOpenChange={setOpen}
        api={api}
        query={query}
        activeViewId={activeViewId}
      />
    </>
  );
}

export function SavedViews({ api, query, activeViewId, onApply }: SavedViewsProps) {
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<SavedView | null>(null);
  const active = api.views.find((v) => v.id === activeViewId);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            className="shrink-0"
            aria-label={active ? `Views, ${active.name} active` : 'Views'}
          >
            <Bookmark className="h-3.5 w-3.5" aria-hidden />
            <span className="max-w-[140px] truncate">{active ? active.name : 'Views'}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72" data-plan-read="">
          <DropdownMenuItem
            icon={BookmarkPlus}
            onSelect={() => setSaveOpen(true)}
            description="Save the current search, filters and sort"
          >
            Save view
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          {api.views.length === 0 ? <p className="px-3 py-2 text-xs text-faint">No saved views yet</p> : null}
          {api.views.map((v) => (
            <DropdownMenuItem
              key={v.id}
              icon={v.id === activeViewId ? Check : undefined}
              onSelect={() => onApply(v)}
              description={
                [v.isDefault ? 'Default' : null, v.isShared ? 'Shared' : null].filter(Boolean).join(' · ') ||
                undefined
              }
            >
              {v.name}
            </DropdownMenuItem>
          ))}
          {active && active.isOwner !== false ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{active.name}</DropdownMenuLabel>
              <DropdownMenuItem
                icon={Star}
                disabledReason={active.isDefault ? 'Already your default view' : null}
                onSelect={() => api.update.mutate({ id: active.id, isDefault: true })}
              >
                Set as default
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={Share2}
                onSelect={() => api.update.mutate({ id: active.id, isShared: !active.isShared })}
              >
                {active.isShared ? 'Stop sharing' : 'Share with team'}
              </DropdownMenuItem>
              <DropdownMenuItem icon={Trash2} destructive onSelect={() => setToDelete(active)}>
                Delete view
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        api={api}
        query={query}
        activeViewId={activeViewId}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this view?"
        description={
          toDelete ? `"${toDelete.name}" will be removed for everyone it is shared with.` : undefined
        }
        onConfirm={async () => {
          if (toDelete) await api.remove.mutateAsync({ id: toDelete.id, name: toDelete.name });
          setToDelete(null);
        }}
      />
    </>
  );
}
