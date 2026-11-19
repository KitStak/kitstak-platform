'use client';
/**
 * The saved views bar. Mount it on any list whose filters, sort and columns live in the URL:
 *
 *   <SavedViewsBar page="audit" />
 *
 * It lists your views and the shared ones, saves what is on screen under a name, and lets you
 * rename a view, update it, share it with the workspace, open it by default or delete it (with
 * Undo). A view is the query string of the page, so opening one is just going to that address.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, Check, MoreHorizontal, Pencil, RefreshCw, Star, StarOff, Trash2, Users, UsersRound } from 'lucide-react';
import { Button, Checkbox, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Field, Input, Skeleton, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { ScrollX } from '@/components/ui/scroll-x';
import { useShell } from '@/features/shell/shell-context';
import type { SavedViewPage } from '@/lib/constants';
import { useSavedViews } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import type { SavedViewDTO } from '@/lib/types';
import { deleteViewAction, saveViewAction } from '@/server/actions/views';
import { describeQuery, normalizeQuery, readViewConfig, toViewConfig, viewHref } from './view-query';

export interface SavedViewsBarProps {
  readonly page: SavedViewPage;
  /** Query keys that are not part of a view (a row that happens to be open, a page number). */
  readonly ignore?: readonly string[];
  /** Shown before the views, like "Views". */
  readonly label?: string;
  readonly className?: string;
}

export function SavedViewsBar({ page, ignore = [], label = 'Views', className }: SavedViewsBarProps) {
  const shell = useShell();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const views = useSavedViews(page);
  const canShare = shell.can('job:manage');
  const current = normalizeQuery(params, ignore);
  const [dialog, setDialog] = useState<{ mode: 'new' } | { mode: 'rename'; view: SavedViewDTO } | null>(null);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const appliedDefault = useRef(false);

  const list = useMemo(() => views.data ?? [], [views.data]);
  const active = list.find((view) => readViewConfig(view.config).query === current) ?? null;

  // A default view opens by itself when the page is opened with no filters at all.
  useEffect(() => {
    if (appliedDefault.current || views.data === undefined) return;
    appliedDefault.current = true;
    if (current !== '') return;
    const mine = views.data.find((view) => view.isDefault && view.mine);
    const config = mine ? readViewConfig(mine.config) : null;
    if (config && config.query !== '') router.replace(viewHref(pathname, config), { scroll: false });
  }, [views.data, current, pathname, router]);

  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: qk.views(page) });

  const save = async (input: Parameters<typeof saveViewAction>[0], done: string): Promise<SavedViewDTO | null> => {
    setBusy(true);
    try {
      const result = await saveViewAction(input);
      if (!result.ok) {
        setError(result.error.fields?.name ?? result.error.message);
        toast.error('Could not save the view', result.error.message);
        return null;
      }
      await refresh();
      toast.success(done);
      return result.data;
    } catch {
      toast.error('Could not save the view', 'Check your connection and try again.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const submit = async (): Promise<void> => {
    const clean = name.trim();
    if (clean === '') {
      setError('Give the view a name.');
      return;
    }
    if (list.some((view) => view.mine && view.name.toLowerCase() === clean.toLowerCase() && (dialog?.mode !== 'rename' || view.id !== dialog.view.id))) {
      setError('You already have a view with that name.');
      return;
    }
    const saved =
      dialog?.mode === 'rename'
        ? await save({ id: dialog.view.id, page, name: clean, config: { ...dialog.view.config }, shared: canShare ? shared : dialog.view.shared, isDefault }, 'View saved')
        : await save({ page, name: clean, config: { ...toViewConfig(params, ignore) }, shared: canShare && shared, isDefault }, `Saved "${clean}"`);
    if (saved) setDialog(null);
  };

  const remove = async (view: SavedViewDTO): Promise<void> => {
    const result = await deleteViewAction({ viewId: view.id });
    if (!result.ok) {
      toast.error('Could not delete the view', result.error.message);
      return;
    }
    await refresh();
    toast.undo(`Deleted "${view.name}"`, {
      onUndo: async () => {
        const back = await saveViewAction({ page, name: view.name, config: { ...view.config }, shared: view.shared, isDefault: view.isDefault });
        if (!back.ok) throw new Error(back.error.message);
        await refresh();
      },
    });
  };

  const openNew = (): void => {
    setName('');
    setShared(false);
    setIsDefault(false);
    setError(null);
    setDialog({ mode: 'new' });
  };

  const openRename = (view: SavedViewDTO): void => {
    setName(view.name);
    setShared(view.shared);
    setIsDefault(view.isDefault);
    setError(null);
    setDialog({ mode: 'rename', view });
  };

  const chip = 'inline-flex h-7 items-center gap-1.5 rounded-full border text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

  return (
    // On a phone the views sit on one line that scrolls sideways. A wrapping list changed height
    // when the views arrived a moment after the page, and pushed the whole screen down (layout shift).
    // The row is as wide as its chips (`w-max`), so ScrollX sees it grow and gives the region a tab stop.
    <ScrollX label="Saved views" className={className} scrollerClassName="-m-1 p-1">
      <div className="flex w-max min-w-full flex-nowrap items-center gap-1.5 whitespace-nowrap sm:w-auto sm:flex-wrap [&>*]:shrink-0" data-testid={`views-bar-${page}`} role="group" aria-label="Saved views">
      <span className="mr-1 text-xs font-medium text-fg-muted">{label}</span>
      {views.isLoading ? <Skeleton width={160} height={28} /> : null}
      {views.isError ? (
        <button type="button" className="text-xs font-medium text-fg-link hover:underline" onClick={() => void views.refetch()}>
          Views did not load. Try again
        </button>
      ) : null}
      {list.map((view) => {
        const config = readViewConfig(view.config);
        const on = active?.id === view.id;
        const canChange = view.mine || canShare;
        return (
          <span key={view.id} className={cn(chip, 'pr-0.5 pl-0', on ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border-subtle bg-panel text-fg-secondary hover:bg-hover')} data-testid={`view-${view.name}`} data-active={on ? 'yes' : 'no'}>
            <button
              type="button"
              aria-pressed={on}
              title={`${view.name}. ${describeQuery(config.query)}${view.shared ? '. Shared with the workspace' : ''}${view.isDefault && view.mine ? '. Opens by default' : ''}`}
              onClick={() => router.push(viewHref(pathname, config), { scroll: false })}
              className="inline-flex h-full items-center gap-1 rounded-l-full pr-1 pl-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {view.isDefault && view.mine ? <Star aria-hidden className="size-3" /> : null}
              {view.shared ? <Users aria-hidden className="size-3" /> : null}
              {view.name}
            </button>
            {canChange ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label={`Options for the view ${view.name}`} className="inline-flex size-6 items-center justify-center rounded-full hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid={`view-menu-${view.name}`}>
                    <MoreHorizontal aria-hidden className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={() => openRename(view)}>
                    Rename and options
                  </DropdownMenuItem>
                  <DropdownMenuItem icon={<RefreshCw aria-hidden />} disabled={on} onSelect={() => void save({ id: view.id, page, name: view.name, config: { ...toViewConfig(params, ignore) } }, `"${view.name}" now holds what is on screen`)}>
                    Update to what is on screen
                  </DropdownMenuItem>
                  {view.mine ? (
                    <DropdownMenuItem icon={view.isDefault ? <StarOff aria-hidden /> : <Star aria-hidden />} onSelect={() => void save({ id: view.id, page, name: view.name, config: { ...view.config }, isDefault: !view.isDefault }, view.isDefault ? 'This view no longer opens by default' : `"${view.name}" opens by default now`)}>
                      {view.isDefault ? 'Stop opening by default' : 'Open by default'}
                    </DropdownMenuItem>
                  ) : null}
                  {canShare ? (
                    <DropdownMenuItem icon={<UsersRound aria-hidden />} onSelect={() => void save({ id: view.id, page, name: view.name, config: { ...view.config }, shared: !view.shared }, view.shared ? 'Only you see this view now' : 'Everyone in the workspace sees this view now')}>
                      {view.shared ? 'Stop sharing' : 'Share with the workspace'}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem icon={<Trash2 aria-hidden />} onSelect={() => void remove(view)}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="w-2" />
            )}
          </span>
        );
      })}
      {!views.isLoading && list.length === 0 ? <span className="text-xs text-fg-muted">Save the filters you use often and come back to them in one click.</span> : null}
      {active ? (
        <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
          <Check aria-hidden className="size-3.5 text-success" />
          Showing this view
        </span>
      ) : (
        <Button size="sm" variant="ghost" leadingIcon={<BookmarkPlus aria-hidden className="size-3.5" />} onClick={openNew} disabled={current === ''} title={current === '' ? 'Pick some filters first, then save them as a view.' : undefined} data-testid="view-save">
          Save view
        </Button>
      )}
      </div>
      <Dialog open={dialog !== null} onOpenChange={(next) => !next && setDialog(null)}>
        <DialogContent size="sm" data-testid="view-dialog">
          <DialogHeader title={dialog?.mode === 'rename' ? 'Rename view' : 'Save this view'} description={dialog?.mode === 'rename' ? undefined : `Keeps what is on screen now: ${describeQuery(current).toLowerCase()}.`} />
          <DialogBody>
            <form
              id="view-form"
              className="flex flex-col gap-4 pb-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <Field label="Name" error={error}>
                {({ inputId, invalid }) => (
                  <Input
                    id={inputId}
                    invalid={invalid}
                    autoFocus
                    value={name}
                    maxLength={80}
                    onChange={(event) => {
                      setName(event.target.value);
                      setError(null);
                    }}
                    placeholder="This month, rate changes"
                    data-testid="view-name"
                  />
                )}
              </Field>
              <Checkbox checked={isDefault} onCheckedChange={(checked) => setIsDefault(checked === true)} label="Open this view by default" description="When you open this page with no filters, it starts on this view." data-testid="view-default" />
              {canShare ? <Checkbox checked={shared} onCheckedChange={(checked) => setShared(checked === true)} label="Share with the workspace" description="Everyone who can open this page sees the view. Only managers can change it." data-testid="view-shared" /> : null}
            </form>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" form="view-form" loading={busy} data-testid="view-submit">
              {dialog?.mode === 'rename' ? 'Save' : 'Save view'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollX>
  );
}
