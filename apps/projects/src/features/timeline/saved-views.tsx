'use client';
/**
 * Saved views for the Timeline, Calendar and Workload (pm.saved_views, type = the view). A view
 * remembers the layout options (zoom, grouping, colors, toggles…); keep it for yourself or share it
 * with everyone on the project. Picking a view applies it; changes after that can update it.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bookmark, BookmarkPlus, Check, ChevronDown, Lock, RefreshCw, Trash2, Users } from 'lucide-react';
import {
  Button,
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
  Switch,
  toast,
} from '@/components/ui';
import { useProjectViews } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import type { SavedViewDTO } from '@/lib/types';
import type { ViewConfig } from '@/lib/view-config';
import { createSavedViewAction, deleteSavedViewAction, updateSavedViewAction } from '@/server/actions/views';
import { useCurrentProject } from '@/features/projects/project-context';
import { useShell } from '@/features/shell/shell-context';

export type SavedViewKind = 'timeline' | 'calendar' | 'workload';

const NOUN: Readonly<Record<SavedViewKind, string>> = { timeline: 'timeline', calendar: 'calendar', workload: 'workload' };

/** Options stored under `config.options`; a few also map onto the shared ViewConfig fields. */
export function optionsFromConfig<T extends object>(config: ViewConfig, defaults: T): Partial<T> {
  const raw = config.options;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key in defaults && typeof value === typeof (defaults as Record<string, unknown>)[key]) out[key] = value;
  }
  return out as Partial<T>;
}

function configFor(kind: SavedViewKind, options: Record<string, unknown>): Record<string, unknown> {
  return {
    options,
    ...(kind === 'timeline' && typeof options.zoom === 'string' ? { zoom: options.zoom } : {}),
    ...(kind === 'calendar' && typeof options.mode === 'string' ? { calendarMode: options.mode } : {}),
    ...(typeof options.showCompleted === 'boolean' ? { showCompleted: options.showCompleted } : {}),
    ...(typeof options.showSubtasks === 'boolean' ? { showSubtasks: options.showSubtasks } : {}),
  };
}

function sameOptions(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return Object.keys(a).every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

export function SavedViewsMenu<T extends object>({
  kind,
  options,
  defaults,
  activeId,
  onApply,
}: {
  readonly kind: SavedViewKind;
  /** Current options to save (only the keys that belong in a view). */
  readonly options: T;
  readonly defaults: T;
  readonly activeId: string | null;
  readonly onApply: (options: Partial<T>, viewId: string | null) => void;
}) {
  const { project, capabilities } = useCurrentProject();
  const { user } = useShell();
  const queryClient = useQueryClient();
  const viewsQuery = useProjectViews(project.key);
  const [dialog, setDialog] = useState(false);
  const views = (viewsQuery.data ?? []).filter((view) => view.type === kind && (view.userId === null || view.userId === user.id));
  const active = views.find((view) => view.id === activeId) ?? null;
  const canShare = Boolean(capabilities['view:save_shared']);
  const canEdit = (view: SavedViewDTO) => view.userId === user.id || (view.userId === null && canShare);
  const current = options as unknown as Record<string, unknown>;
  const changed = active ? !sameOptions(current, { ...(defaults as Record<string, unknown>), ...optionsFromConfig(active.config, defaults) }) : false;
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.projectViews(project.key) });

  const updateActive = async () => {
    if (!active) return;
    const result = await updateSavedViewAction({ viewId: active.id, patch: { config: configFor(kind, current) } });
    if (!result.ok) {
      toast.error("Couldn't update the view", result.error.message);
      return;
    }
    await refresh();
    toast.success(`Updated “${active.name}”`);
  };

  const remove = async (view: SavedViewDTO) => {
    const result = await deleteSavedViewAction({ viewId: view.id });
    if (!result.ok) {
      toast.error("Couldn't delete the view", result.error.message);
      return;
    }
    if (view.id === activeId) onApply({}, null);
    await refresh();
    toast.undo(`Deleted “${view.name}”`, {
      onUndo: async () => {
        const again = await createSavedViewAction({ projectId: project.id, name: view.name, type: kind, config: view.config as Record<string, unknown>, shared: view.userId === null });
        if (!again.ok) throw new Error(again.error.message);
        await refresh();
      },
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" leadingIcon={<Bookmark aria-hidden />} data-testid={`${kind}-views`} aria-label={active ? `View: ${active.name}` : 'Saved views'}>
            <span className="max-w-36 truncate max-[639px]:sr-only">{active ? active.name : 'Views'}</span>
            {changed ? <span aria-label="Changed since saved" className="size-1.5 rounded-full bg-primary" /> : null}
            <ChevronDown aria-hidden className="size-3.5 text-icon" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Saved {NOUN[kind]} views</DropdownMenuLabel>
          <DropdownMenuItem icon={activeId === null ? <Check aria-hidden /> : <span aria-hidden className="size-4" />} onSelect={() => onApply(defaults, null)}>
            Default {NOUN[kind]}
          </DropdownMenuItem>
          {views.map((view) => (
            <DropdownMenuItem
              key={view.id}
              icon={view.id === activeId ? <Check aria-hidden /> : <span aria-hidden className="size-4" />}
              description={view.userId === null ? 'Shared with the project' : 'Only you'}
              onSelect={() => onApply({ ...defaults, ...optionsFromConfig(view.config, defaults) }, view.id)}
            >
              <span className="flex items-center gap-1.5">
                {view.userId === null ? <Users aria-hidden className="size-3.5 text-icon" /> : <Lock aria-hidden className="size-3.5 text-icon" />}
                <span className="truncate">{view.name}</span>
              </span>
            </DropdownMenuItem>
          ))}
          {views.length === 0 ? <p className="px-2 py-1.5 text-xs text-fg-muted">Save the way this {NOUN[kind]} looks so you can come back to it in one click.</p> : null}
          <DropdownMenuSeparator />
          {active && changed && canEdit(active) ? (
            <DropdownMenuItem icon={<RefreshCw aria-hidden />} onSelect={() => void updateActive()}>
              Update “{active.name}”
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem icon={<BookmarkPlus aria-hidden />} onSelect={() => setDialog(true)} data-testid={`${kind}-save-view`}>
            Save as a new view…
          </DropdownMenuItem>
          {active && canEdit(active) ? (
            <DropdownMenuItem variant="danger" icon={<Trash2 aria-hidden />} onSelect={() => void remove(active)}>
              Delete “{active.name}”
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog ? (
        <SaveViewDialog
          kind={kind}
          canShare={canShare}
          onClose={() => setDialog(false)}
          onSave={async (name, shared) => {
            const result = await createSavedViewAction({ projectId: project.id, name, type: kind, config: configFor(kind, current), shared });
            if (!result.ok) {
              toast.error("Couldn't save the view", result.error.message);
              return false;
            }
            await refresh();
            onApply(options, result.data.id);
            toast.success(`Saved “${result.data.name}”`, shared ? 'Everyone on the project can use it.' : 'Only you can see it.');
            return true;
          }}
        />
      ) : null}
    </>
  );
}

function SaveViewDialog({
  kind,
  canShare,
  onClose,
  onSave,
}: {
  readonly kind: SavedViewKind;
  readonly canShare: boolean;
  readonly onClose: () => void;
  readonly onSave: (name: string, shared: boolean) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(`Give the view a name, like “${kind === 'workload' ? 'Next month in hours' : kind === 'calendar' ? 'Due dates by priority' : 'Big picture by quarter'}”.`);
      return;
    }
    setSaving(true);
    const ok = await onSave(trimmed, shared);
    setSaving(false);
    if (ok) onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm" aria-describedby={undefined}>
        <DialogHeader title={`Save this ${NOUN[kind]} view`} description="Keeps the layout options you picked, like zoom, grouping and colors." />
        <DialogBody className="flex flex-col gap-4">
          <Field label="Name" error={error ?? undefined}>
            {(ids) => (
              <Input
                id={ids.inputId}
                aria-describedby={ids.describedBy}
                invalid={ids.invalid}
                autoFocus
                maxLength={80}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void submit();
                  }
                }}
                data-testid="saved-view-name"
              />
            )}
          </Field>
          {canShare ? (
            <Switch size="sm" label="Share with everyone on this project" checked={shared} onCheckedChange={setShared} />
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => void submit()} data-testid="saved-view-submit">
            Save view
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
