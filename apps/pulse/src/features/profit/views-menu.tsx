'use client';
/**
 * Saved views of the Profit explorer. A view is the whole query string: grouping, period,
 * comparison, filters, sort, columns and which view is open. Relative periods stay relative, so
 * "Last month by client" always means last month. Deleting a view can be undone.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bookmark, BookmarkPlus, Globe, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Field, Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/components/ui/toast';
import { useServerAction } from '@/lib/hooks/use-action';
import { useSavedViews } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import type { SavedViewDTO } from '@/lib/types';
import { deleteViewAction, saveViewAction } from '@/server/actions/views';
import { useShell } from '@/features/shell/shell-context';
import { viewToQuery } from './profit-model';

/** Keys that are part of a view. Open drawers are not. */
const SKIP = new Set(['entries', 'day', 'savedView']);

export function ViewsMenu({ params, onApply }: { readonly params: URLSearchParams | null; readonly onApply: (query: Record<string, string>) => void }) {
  const { can } = useShell();
  const queryClient = useQueryClient();
  const views = useSavedViews('profit');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const save = useServerAction(saveViewAction, { invalidate: [qk.views('profit')], silentError: true });
  const remove = useServerAction(deleteViewAction, { invalidate: [qk.views('profit')] });
  const list = views.data ?? [];

  const currentQuery = (): Record<string, string> => {
    const out: Record<string, string> = {};
    params?.forEach((value, key) => {
      if (!SKIP.has(key)) out[key] = value;
    });
    return out;
  };

  const submit = async () => {
    const saved = await save.run({ page: 'profit', name, config: { query: currentQuery() }, shared });
    if (!saved) return;
    toast.success(`Saved the view ${saved.name}`);
    setSaving(false);
    setName('');
    setShared(false);
  };

  const deleteView = async (view: SavedViewDTO) => {
    // Take it off the list right away; put it back if the server says no.
    queryClient.setQueryData<SavedViewDTO[]>(qk.views('profit'), (current) => (current ?? []).filter((item) => item.id !== view.id));
    const done = await remove.run({ viewId: view.id });
    if (done === undefined) {
      void queryClient.invalidateQueries({ queryKey: qk.views('profit') });
      return;
    }
    toast.undo(`Deleted the view ${view.name}`, {
      onUndo: async () => {
        const result = await saveViewAction({ page: 'profit', name: view.name, config: { ...view.config }, shared: view.shared });
        if (!result.ok) throw new Error(result.error.message);
        await queryClient.invalidateQueries({ queryKey: qk.views('profit') });
      },
    });
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="secondary" leadingIcon={<Bookmark aria-hidden />} data-testid="views-menu">
            Views{list.length > 0 ? ` (${list.length})` : ''}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[320px] max-w-[calc(100vw-32px)]">
          <div className="flex flex-col gap-2 p-1">
            <p className="px-1 text-xs font-medium text-fg-muted">Saved views</p>
            {views.isError ? (
              <p role="alert" className="px-1 text-sm text-danger-text">
                We could not load your views. Close this and try again.
              </p>
            ) : views.isLoading ? (
              <span role="status" aria-busy="true" className="ks-skeleton mx-1 block h-8 rounded-md">
                <span className="sr-only">Loading your views</span>
              </span>
            ) : list.length === 0 ? (
              <p className="px-1 text-sm text-fg-secondary">No saved views yet. Set the period, filters and columns the way you like, then save it here to come back in one click.</p>
            ) : (
              <ul className="flex max-h-64 flex-col overflow-y-auto" data-testid="views-list">
                {list.map((view) => (
                  <li key={view.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        onApply(viewToQuery(view.config));
                        setOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
                      data-testid={`view-apply-${view.name}`}
                    >
                      <span className="truncate">{view.name}</span>
                      {view.shared ? <Globe aria-label="Shared with the workspace" className="size-3.5 shrink-0 text-icon" /> : null}
                    </button>
                    {view.mine || can('job:manage') ? <IconButton label={`Delete the view ${view.name}`} icon={<Trash2 aria-hidden />} size="sm" onClick={() => void deleteView(view)} data-testid={`view-delete-${view.name}`} /> : null}
                  </li>
                ))}
              </ul>
            )}
            <Button
              variant="secondary"
              leadingIcon={<BookmarkPlus aria-hidden />}
              onClick={() => {
                setOpen(false);
                setSaving(true);
              }}
              data-testid="view-save-open"
            >
              Save this view
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent size="sm">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <DialogHeader title="Save this view" description="Keeps the grouping, period, filters, sort and columns you see now." />
            <DialogBody className="flex flex-col gap-4">
              <Field label="Name" required error={save.fieldErrors.name ?? null}>
                {({ inputId, describedBy, invalid }) => <Input id={inputId} aria-describedby={describedBy} invalid={invalid} value={name} onChange={(event) => setName(event.target.value)} placeholder="Last month by client" maxLength={80} autoFocus data-testid="view-name" />}
              </Field>
              {can('job:manage') ? <Checkbox checked={shared} onCheckedChange={(value) => setShared(value === true)} label="Share with the workspace" description="Everyone who can open Profit sees this view." /> : null}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setSaving(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={save.pending} disabled={name.trim().length === 0} data-testid="view-save">
                Save view
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
