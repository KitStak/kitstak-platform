'use client';

/** View tab actions: add, rename, duplicate, delete (with Undo), set default, reorder, copy link. */
import { useCallback, useState } from 'react';
import { toast } from '@/components/ui';
import type { ViewTypeMeta } from '@/features/board-views';
import { useCreateView, useDeleteView, useUpdateView } from '@/lib/hooks';
import type { ViewDto } from '@/server/services/contracts/dto';
import { patchBoardSearch } from '../lib/url-state';
import { placementForMove, uniqueViewName } from '../lib/view-order';

export interface ViewActions {
  readonly adding: boolean;
  readonly renamingId: string | null;
  readonly setRenamingId: (id: string | null) => void;
  /** View whose settings should open on first render (newly added, BV-004). */
  readonly settingsOpenFor: string | null;
  readonly add: (meta: ViewTypeMeta) => void;
  readonly rename: (view: ViewDto, name: string) => void;
  readonly duplicate: (view: ViewDto) => void;
  readonly remove: (view: ViewDto) => void;
  readonly setDefault: (view: ViewDto) => void;
  readonly copyLink: (view: ViewDto) => void;
  readonly reorder: (from: number, to: number) => void;
  /** Local order while a reorder is in flight (optimistic). */
  readonly order: readonly string[] | null;
}

export function useViewActions(
  boardId: string,
  views: readonly ViewDto[],
  activeId: string | null,
  defaultViewId: string | null,
  select: (viewId: string) => void,
): ViewActions {
  const createView = useCreateView(boardId);
  const updateView = useUpdateView(boardId);
  const deleteView = useDeleteView(boardId);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [settingsOpenFor, setSettingsOpenFor] = useState<string | null>(null);
  const [order, setOrder] = useState<readonly string[] | null>(null);

  const add = useCallback(
    (meta: ViewTypeMeta) => {
      createView.mutate(
        { type: meta.type, name: uniqueViewName(meta.defaultName, views), afterId: views.at(-1)?.id },
        {
          onSuccess: (view) => {
            select(view.id);
            setRenamingId(view.id);
            if (meta.opensSettings) setSettingsOpenFor(view.id);
          },
        },
      );
    },
    [createView, select, views],
  );

  const rename = useCallback(
    (view: ViewDto, name: string) => {
      const next = name.trim();
      if (next && next !== view.name) updateView.mutate({ viewId: view.id, input: { name: next } });
    },
    [updateView],
  );

  const duplicate = useCallback(
    (view: ViewDto) => {
      createView.mutate(
        { type: view.type, name: uniqueViewName(`${view.name} copy`, views), config: view.config as never, afterId: view.id },
        {
          onSuccess: (copy) => {
            select(copy.id);
            toast.success(`Duplicated as “${copy.name}”`);
          },
        },
      );
    },
    [createView, select, views],
  );

  const remove = useCallback(
    (view: ViewDto) => {
      if (views.length <= 1) return;
      if (view.id === activeId) {
        const fallback = views.find((entry) => entry.id !== view.id && entry.id === defaultViewId) ?? views.find((entry) => entry.id !== view.id);
        if (fallback) select(fallback.id);
      }
      deleteView.mutate(view.id, {
        onSuccess: () =>
          toast.undo(`View “${view.name}” deleted`, {
            onUndo: async () => {
              const restored = await createView.mutateAsync({
                type: view.type,
                name: view.name,
                config: view.config as never,
                beforeId: views.find((entry) => entry.position > view.position && entry.id !== view.id)?.id,
              });
              select(restored.id);
            },
          }),
      });
    },
    [activeId, createView, defaultViewId, deleteView, select, views],
  );

  const setDefault = useCallback(
    (view: ViewDto) =>
      updateView.mutate(
        { viewId: view.id, input: { isDefault: true } },
        { onSuccess: () => toast.success(`“${view.name}” is now the default view`) },
      ),
    [updateView],
  );

  const copyLink = useCallback((view: ViewDto) => {
    const search = patchBoardSearch('', { viewId: view.id });
    const url = `${window.location.origin}${window.location.pathname}${search}`;
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.success('View link copied'))
      .catch(() => toast.error("Couldn't copy the link", url));
  }, []);

  const reorder = useCallback(
    (from: number, to: number) => {
      const placement = placementForMove(views, from, to);
      const moved = views[from];
      if (!placement || !moved) return;
      const ids = views.map((view) => view.id).filter((id) => id !== moved.id);
      ids.splice(to, 0, moved.id);
      setOrder(ids);
      updateView.mutate(
        { viewId: moved.id, input: placement },
        { onSettled: () => setOrder(null), onError: () => toast.error("Couldn't reorder views") },
      );
    },
    [updateView, views],
  );

  return {
    adding: createView.isPending,
    renamingId,
    setRenamingId,
    settingsOpenFor,
    add,
    rename,
    duplicate,
    remove,
    setDefault,
    copyLink,
    reorder,
    order,
  };
}
