'use client';
/**
 * Saved views for the jobs list: name the filters, sort, grouping, columns and layout you are
 * looking at, and come back to them in one click. Stored through the shared saved views domain
 * (`saveViewAction`), so the data team's views bar can replace this file without a migration.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, Check, MoreHorizontal, Trash2, Users } from 'lucide-react';
import { Button, Checkbox, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Field, Input, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { useSavedViews } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import type { SavedViewDTO } from '@/lib/types';
import { deleteViewAction, saveViewAction } from '@/server/actions/views';
import { DEFAULT_VIEW, toViewConfig, type JobsViewConfig } from './jobs-config';
import { callAction } from './use-job-actions';

export function JobsViewsBar({ current, activeId, onApply, canShare }: { readonly current: JobsViewConfig; readonly activeId: string | null; readonly onApply: (config: JobsViewConfig, id: string | null) => void; readonly canShare: boolean }) {
  const queryClient = useQueryClient();
  const views = useSavedViews('jobs');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = views.data ?? [];
  const isDefault = activeId === null && JSON.stringify({ ...current, columns: [], layout: '', group: '' }) === JSON.stringify({ ...DEFAULT_VIEW, columns: [], layout: '', group: '' });

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the view a name.');
      return;
    }
    setSaving(true);
    const result = await saveViewAction({ page: 'jobs', name: trimmed, config: { ...current }, shared });
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: qk.views('jobs') });
    setOpen(false);
    setName('');
    setShared(false);
    onApply(current, result.data.id);
    toast.success(`Saved the view "${trimmed}"`);
  };

  const remove = async (view: SavedViewDTO) => {
    const deleted = await deleteViewAction({ viewId: view.id });
    if (!deleted.ok) {
      toast.error("Couldn't delete the view", deleted.error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: qk.views('jobs') });
    if (activeId === view.id) onApply(DEFAULT_VIEW, null);
    toast.undo(`Deleted the view "${view.name}"`, {
      onUndo: async () => {
        const back = await callAction(saveViewAction({ page: 'jobs', name: view.name, config: { ...view.config }, shared: view.shared }), "Couldn't bring the view back");
        if (back) await queryClient.invalidateQueries({ queryKey: qk.views('jobs') });
      },
    });
  };

  const update = async (view: SavedViewDTO) => {
    const saved = await callAction(saveViewAction({ id: view.id, page: 'jobs', name: view.name, config: { ...current }, shared: view.shared }), "Couldn't update the view");
    if (!saved) return;
    await queryClient.invalidateQueries({ queryKey: qk.views('jobs') });
    onApply(current, view.id);
    toast.success(`Updated "${view.name}"`);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="jobs-views-bar">
      <span className="mr-1 text-xs font-medium text-fg-muted">Views</span>
      <ViewChip label="Everything" active={isDefault} onClick={() => onApply({ ...DEFAULT_VIEW, columns: current.columns, layout: current.layout, group: current.group }, null)} />
      {list.map((view) => (
        <span key={view.id} className="inline-flex items-center">
          <ViewChip label={view.name} shared={view.shared} active={activeId === view.id} onClick={() => onApply(toViewConfig(view.config), view.id)} grouped />
          {view.mine ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Options for the view ${view.name}`}
                  className={cn(
                    'inline-flex h-7 w-6 items-center justify-center rounded-r-full border border-l-0 text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    activeId === view.id ? 'border-primary bg-primary-subtle' : 'border-border-subtle bg-panel',
                  )}
                >
                  <MoreHorizontal aria-hidden className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem icon={<Check aria-hidden />} onSelect={() => void update(view)}>
                  Save what is on screen to this view
                </DropdownMenuItem>
                <DropdownMenuItem variant="danger" icon={<Trash2 aria-hidden />} onSelect={() => void remove(view)}>
                  Delete this view
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </span>
      ))}
      <Button variant="ghost" size="sm" leadingIcon={<BookmarkPlus aria-hidden />} onClick={() => setOpen(true)} data-testid="jobs-save-view">
        Save view
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader title="Save this view" description="Keeps the search, filters, sort, grouping, columns and layout that are on screen now." />
          <DialogBody>
            <form
              id="save-view-form"
              className="flex flex-col gap-3 pb-2"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <Field label="Name" error={error} required>
                {({ inputId, describedBy, invalid }) => (
                  <Input
                    id={inputId}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    autoFocus
                    value={name}
                    maxLength={80}
                    placeholder="Losing money this month"
                    onChange={(event) => {
                      setName(event.target.value);
                      setError(null);
                    }}
                    data-testid="view-name"
                  />
                )}
              </Field>
              {canShare ? <Checkbox checked={shared} onCheckedChange={(value) => setShared(value === true)} label="Share with everyone in this workspace" /> : null}
            </form>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="save-view-form" loading={saving} data-testid="view-save">
              Save view
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ViewChip({ label, active, onClick, shared, grouped }: { readonly label: string; readonly active: boolean; readonly onClick: () => void; readonly shared?: boolean; readonly grouped?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 max-w-[220px] items-center gap-1.5 border px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        grouped ? 'rounded-l-full' : 'rounded-full',
        active ? 'border-primary bg-primary-subtle text-fg' : 'border-border-subtle bg-panel text-fg-secondary hover:bg-hover hover:text-fg',
      )}
    >
      {shared ? <Users aria-hidden className="size-3 shrink-0" /> : null}
      <span className="truncate">{label}</span>
    </button>
  );
}
