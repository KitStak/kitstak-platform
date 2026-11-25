'use client';
/**
 * Saved views picker for the Board, List and Table: switch between "All tasks" and saved
 * views (personal or shared with the project), save the current filters/layout as a new view,
 * rename, make it open first, delete (with Undo).
 */
import { useState } from 'react';
import { Bookmark, BookmarkPlus, Check, ChevronDown, Lock, Pencil, Star, StarOff, Trash2, Users } from 'lucide-react';
import {
  Button,
  Checkbox,
  ConfirmDialog,
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
  ToggleGroup,
  cn,
} from '@/components/ui';
import type { SavedViewDTO } from '@/lib/types';
import type { ViewStateApi } from './use-view-state';
import { useCardExtras } from './card-extras';

const TYPE_NOUN: Readonly<Record<ViewStateApi['type'], string>> = { board: 'board', list: 'list', table: 'table' };

function SaveViewDialog({
  open,
  onOpenChange,
  view,
  mode,
  target,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly view: ViewStateApi;
  readonly mode: 'create' | 'rename';
  readonly target?: SavedViewDTO | null;
}) {
  const [name, setName] = useState(mode === 'rename' ? (target?.name ?? '') : '');
  const [shared, setShared] = useState<'me' | 'team'>('me');
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the view a name, like “My urgent tasks”.');
      return;
    }
    setSaving(true);
    const ok =
      mode === 'rename' && target
        ? await view.renameView(target.id, trimmed)
        : Boolean(await view.saveAs(trimmed, { shared: shared === 'team', isDefault }));
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader
          title={mode === 'rename' ? 'Rename view' : 'Save this view'}
          description={mode === 'rename' ? undefined : `Saves your filters, grouping and sorting so you can come back to this ${TYPE_NOUN[view.type]} in one click.`}
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <Field label="Name" error={error}>
              {({ inputId, describedBy, invalid }) => (
              <Input
                id={inputId}
                aria-describedby={describedBy}
                invalid={invalid}
                autoFocus
                value={name}
                maxLength={80}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
                placeholder="For example: My urgent tasks"
                data-testid="save-view-name"
              />
              )}
            </Field>
            {mode === 'create' ? (
              <>
                <Field
                  label="Who can use it"
                  hint={view.canSaveShared ? undefined : 'Only project editors can share views with everyone. This one will be just for you.'}
                >
                  {() => (
                  <ToggleGroup
                    label="Who can use it"
                    value={shared}
                    onValueChange={setShared}
                    options={[
                      { value: 'me', label: 'Just me', icon: <Lock aria-hidden className="size-3.5" /> },
                      { value: 'team', label: 'Everyone on the project', icon: <Users aria-hidden className="size-3.5" />, disabled: !view.canSaveShared },
                    ]}
                  />
                  )}
                </Field>
                <Checkbox
                  checked={isDefault}
                  onCheckedChange={(checked) => setIsDefault(checked === true)}
                  label="Open this view first"
                  description={shared === 'team' ? `Everyone sees it when they open the ${TYPE_NOUN[view.type]}.` : `You see it when you open the ${TYPE_NOUN[view.type]}.`}
                />
              </>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} data-testid="save-view-submit">
              {mode === 'rename' ? 'Rename' : 'Save view'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SavedViewsMenu({ view, compact = false }: { readonly view: ViewStateApi; readonly compact?: boolean }) {
  const [dialog, setDialog] = useState<'create' | 'rename' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const active = view.activeView;
  const canEditActive = active ? view.canEditView(active) : false;
  const extras = useCardExtras();
  const allLabel = `All ${extras.noun?.plural ?? 'tasks'}`;
  const title = active?.name ?? allLabel;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="saved-views-trigger"
            aria-label={`View: ${title}. Change view`}
            className={cn(
              'inline-flex h-8 max-w-56 shrink-0 items-center gap-1.5 rounded-sm px-2 text-sm font-semibold text-fg outline-none',
              'hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus data-[state=open]:bg-selected',
            )}
          >
            {active ? (
              active.userId ? <Lock aria-hidden className="size-4 shrink-0 text-icon" /> : <Users aria-hidden className="size-4 shrink-0 text-icon" />
            ) : (
              <Bookmark aria-hidden className="size-4 shrink-0 text-icon" />
            )}
            <span className={cn('truncate', compact && 'max-w-24')}>{title}</span>
            {view.dirty ? <span aria-label="Unsaved changes" title="Unsaved changes" className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
            <ChevronDown aria-hidden className="size-3.5 shrink-0 text-icon" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72" data-testid="saved-views-menu">
          <DropdownMenuLabel>Views</DropdownMenuLabel>
          <DropdownMenuItem icon={<Bookmark aria-hidden />} onSelect={() => view.selectView(null)} description={`Every ${extras.noun?.singular ?? 'task'}, with your own filters`}>
            <span className="inline-flex items-center gap-2">
              {allLabel}
              {!active ? <Check aria-hidden className="size-3.5 text-primary-text" /> : null}
            </span>
          </DropdownMenuItem>
          {view.views.map((saved) => (
            <DropdownMenuItem
              key={saved.id}
              icon={saved.userId ? <Lock aria-hidden /> : <Users aria-hidden />}
              onSelect={() => view.selectView(saved.id)}
              description={`${saved.userId ? 'Just you' : 'Shared with the project'}${saved.isDefault ? ' · opens first' : ''}`}
              data-testid="saved-view-item"
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className="truncate">{saved.name}</span>
                {saved.isDefault ? <Star aria-hidden className="size-3 shrink-0 fill-warning text-warning" /> : null}
                {active?.id === saved.id ? <Check aria-hidden className="size-3.5 shrink-0 text-primary-text" /> : null}
              </span>
            </DropdownMenuItem>
          ))}
          {view.views.length === 0 && !view.viewsLoading ? (
            <p className="px-2.5 pt-1 pb-2 text-xs text-fg-muted">Filter or group the {TYPE_NOUN[view.type]}, then save it here to reuse it later.</p>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={<BookmarkPlus aria-hidden />} onSelect={() => setDialog('create')} data-testid="save-view-new">
            Save as a new view…
          </DropdownMenuItem>
          {active && canEditActive ? (
            <>
              <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={() => setDialog('rename')}>
                Rename “{active.name}”…
              </DropdownMenuItem>
              <DropdownMenuItem icon={active.isDefault ? <StarOff aria-hidden /> : <Star aria-hidden />} onSelect={() => void view.setDefaultView(active.id, !active.isDefault)}>
                {active.isDefault ? 'Stop opening this view first' : 'Open this view first'}
              </DropdownMenuItem>
              <DropdownMenuItem icon={<Trash2 aria-hidden />} variant="danger" onSelect={() => setConfirmDelete(true)} data-testid="delete-view">
                Delete “{active.name}”
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog ? <SaveViewDialog key={`${dialog}-${active?.id ?? 'none'}`} open onOpenChange={(open) => !open && setDialog(null)} view={view} mode={dialog} target={active} /> : null}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${active?.name ?? ''}”?`}
        description={active?.userId ? 'This view is only yours. Your tasks stay exactly as they are.' : 'Everyone on the project loses this view. Tasks stay exactly as they are.'}
        confirmLabel="Delete view"
        destructive
        onConfirm={() => {
          setConfirmDelete(false);
          if (active) void view.deleteView(active.id);
        }}
      />
    </>
  );
}

/** Opens the save dialog from outside the menu (the toolbar's "Save view" button). */
export function SaveViewButton({ view, iconOnly = false }: { readonly view: ViewStateApi; readonly iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="tertiary" size="sm" leadingIcon={<BookmarkPlus aria-hidden />} onClick={() => setOpen(true)} data-testid="save-view">
        <span className={cn(iconOnly && 'sr-only')}>Save view</span>
      </Button>
      {open ? <SaveViewDialog open onOpenChange={setOpen} view={view} mode="create" /> : null}
    </>
  );
}
