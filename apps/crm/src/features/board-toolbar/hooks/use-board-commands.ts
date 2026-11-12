'use client';

/**
 * Board-level commands for the header and the "…" menu: favorite, rename, description,
 * duplicate, move, save as template, archive / delete with Undo, export.
 */
import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui';
import { exportBoardCsv, exportBoardXlsx } from '@/features/import-export';
import { routes } from '@/features/shell/routes';
import { useOrg } from '@/features/shell/org-context';
import {
  errorMessage,
  useApi,
  useBoardLifecycle,
  useDuplicateBoard,
  useFavorites,
  useToggleFavorite,
  useUpdateBoard,
} from '@/lib/hooks';
import type { BoardDto } from '@/server/services/contracts/dto';

export type DuplicateMode = 'structure' | 'items' | 'items_updates';

export interface BoardCommands {
  readonly isFavorite: boolean;
  readonly toggleFavorite: () => void;
  readonly rename: (name: string) => void;
  readonly setDescription: (description: string) => void;
  readonly update: ReturnType<typeof useUpdateBoard>;
  readonly duplicate: (mode: DuplicateMode, name: string) => Promise<void>;
  readonly duplicating: boolean;
  readonly moveTo: (workspaceId: string, folderId: string | null, label: string) => void;
  readonly saveAsTemplate: () => Promise<void>;
  readonly archive: () => void;
  readonly remove: () => void;
  readonly removing: boolean;
  readonly exportAs: (format: 'csv' | 'xlsx', viewConfig: Record<string, unknown> | undefined) => void;
}

export function useBoardCommands(board: BoardDto | undefined): BoardCommands {
  const boardId = board?.id ?? '';
  const router = useRouter();
  const { org } = useOrg();
  const api = useApi();
  const favorites = useFavorites();
  const toggle = useToggleFavorite();
  const update = useUpdateBoard(boardId);
  const duplicateBoard = useDuplicateBoard();
  const lifecycle = useBoardLifecycle();

  const isFavorite = useMemo(
    () => Boolean(favorites.data?.some((entry) => entry.entityType === 'board' && entry.entityId === boardId)),
    [boardId, favorites.data],
  );

  const toggleFavorite = useCallback(() => {
    if (!board) return;
    toggle.mutate(
      { entityType: 'board', entityId: board.id, favorite: !isFavorite, name: board.name },
      { onSuccess: () => toast.success(isFavorite ? 'Removed from favorites' : 'Added to favorites') },
    );
  }, [board, isFavorite, toggle]);

  const rename = useCallback(
    (name: string) => {
      const next = name.trim();
      if (!board || !next || next === board.name) return;
      update.mutate({ name: next });
    },
    [board, update],
  );

  const setDescription = useCallback(
    (description: string) => {
      if (!board) return;
      const next = description.trim();
      if (next === (board.description ?? '')) return;
      update.mutate({ description: next || null });
    },
    [board, update],
  );

  const open = useCallback((id: string) => router.push(routes.board(org.slug, id)), [org.slug, router]);

  const duplicate = useCallback(
    async (mode: DuplicateMode, name: string) => {
      if (!board) return;
      const copy = await duplicateBoard.mutateAsync({ boardId: board.id, input: { mode, name: name.trim() || undefined } });
      toast.success(`Duplicated as “${copy.name}”`, 'Opening the copy…');
      open(copy.id);
    },
    [board, duplicateBoard, open],
  );

  const moveTo = useCallback(
    (workspaceId: string, folderId: string | null, label: string) => {
      if (!board) return;
      const before = { workspaceId: board.workspaceId, folderId: board.folderId };
      update.mutate(
        { workspaceId, folderId },
        {
          onSuccess: () =>
            toast.undo(`Moved to ${label}`, {
              onUndo: () => update.mutateAsync({ workspaceId: before.workspaceId, folderId: before.folderId }).then(() => undefined),
            }),
        },
      );
    },
    [board, update],
  );

  const saveAsTemplate = useCallback(async () => {
    if (!board) return;
    try {
      const copy = await api.boards.duplicate(board.id, { mode: 'structure', name: `${board.name} template` });
      await api.boards.update(copy.id, {
        settings: { ...copy.settings, isTemplate: true, templateSourceBoardId: board.id },
      });
      toast.success('Saved as a template', `“${copy.name}” keeps this board's columns, groups and views.`);
    } catch (error) {
      toast.error("Couldn't save the template", errorMessage(error));
    }
  }, [api, board]);

  const archive = useCallback(() => {
    if (!board) return;
    lifecycle.mutate(
      { boardId: board.id, action: 'archive' },
      {
        onSuccess: () => {
          router.push(routes.home(org.slug));
          toast.undo(`“${board.name}” archived`, {
            description: 'Find it later in the archive.',
            onUndo: async () => {
              await lifecycle.mutateAsync({ boardId: board.id, action: 'unarchive' });
              open(board.id);
            },
          });
        },
      },
    );
  }, [board, lifecycle, open, org.slug, router]);

  const remove = useCallback(() => {
    if (!board) return;
    lifecycle.mutate(
      { boardId: board.id, action: 'delete' },
      {
        onSuccess: () => {
          router.push(routes.home(org.slug));
          toast.undo(`“${board.name}” moved to trash`, {
            description: 'It stays in the trash for 30 days.',
            onUndo: async () => {
              await lifecycle.mutateAsync({ boardId: board.id, action: 'restore' });
              open(board.id);
            },
          });
        },
      },
    );
  }, [board, lifecycle, open, org.slug, router]);

  const exportAs = useCallback(
    (format: 'csv' | 'xlsx', viewConfig: Record<string, unknown> | undefined) => {
      if (!board) return;
      void (format === 'csv' ? exportBoardCsv : exportBoardXlsx)(board.id, viewConfig, { orgId: org.slug });
    },
    [board, org.slug],
  );

  return {
    isFavorite,
    toggleFavorite,
    rename,
    setDescription,
    update,
    duplicate,
    duplicating: duplicateBoard.isPending,
    moveTo,
    saveAsTemplate,
    archive,
    remove,
    removing: lifecycle.isPending,
    exportAs,
  };
}
