'use client';
import { useMemo, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  SearchInput,
  Skeleton,
  cn,
} from '@/components/ui';
import { useBoards } from '@/lib/hooks';
import type { GroupDto } from '@/server/services/contracts/dto';
import { countLabel } from '../lib/terminology';

export type MoveTarget =
  | { readonly kind: 'items'; readonly itemIds: readonly string[] }
  | { readonly kind: 'group'; readonly group: GroupDto };

/** Pick another board to move items or a whole group to. */
export function MoveToBoardDialog({
  target,
  currentBoardId,
  terminology,
  onOpenChange,
  onMove,
}: {
  readonly target: MoveTarget | null;
  readonly currentBoardId: string;
  readonly terminology: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onMove: (target: MoveTarget, boardId: string, boardName: string) => void;
}) {
  const boards = useBoards();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (boards.data ?? []).filter(
      (board) => board.id !== currentBoardId && (!needle || board.name.toLowerCase().includes(needle)),
    );
  }, [boards.data, currentBoardId, query]);
  const chosen = list.find((board) => board.id === picked);
  const what =
    target?.kind === 'group'
      ? `the group “${target.group.title}”`
      : target
        ? countLabel(target.itemIds.length, terminology.toLowerCase())
        : '';

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (!open) {
          setPicked(null);
          setQuery('');
        }
      }}
    >
      <DialogContent size="sm" data-testid="move-to-board-dialog">
        <DialogHeader
          title="Move to board"
          description={`Move ${what} to another board. Matching columns keep their values.`}
        />
        <DialogBody className="flex flex-col gap-2">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search boards"
            aria-label="Search boards"
            autoFocus
          />
          <ul
            role="listbox"
            aria-label="Boards"
            className="flex max-h-72 flex-col gap-0.5 overflow-y-auto py-1"
            aria-busy={boards.isLoading || undefined}
          >
            {boards.isLoading
              ? Array.from({ length: 5 }, (_, index) => (
                  <li key={index} className="flex h-9 items-center gap-2 px-2" data-skeleton="">
                    <Skeleton width={16} height={16} />
                    <Skeleton height={10} width={`${50 + index * 7}%`} rounded="full" />
                  </li>
                ))
              : list.map((board) => (
                  <li key={board.id} role="option" aria-selected={picked === board.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(board.id)}
                      onDoubleClick={() => target && onMove(target, board.id, board.name)}
                      className={cn(
                        'flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-base hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus',
                        picked === board.id && 'bg-selected text-primary-text hover:bg-selected-hover',
                      )}
                    >
                      <LayoutGrid aria-hidden className="size-4 text-icon" />
                      <span className="truncate">{board.name}</span>
                    </button>
                  </li>
                ))}
            {!boards.isLoading && list.length === 0 ? (
              <li className="px-2 py-6 text-center text-sm text-fg-muted">No other boards match.</li>
            ) : null}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!chosen || !target}
            onClick={() => target && chosen && onMove(target, chosen.id, chosen.name)}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteGroupDialog({
  group,
  itemCount,
  terminology,
  onOpenChange,
  onConfirm,
}: {
  readonly group: GroupDto | null;
  readonly itemCount: number;
  readonly terminology: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: (group: GroupDto) => void;
}) {
  return (
    <ConfirmDialog
      open={group !== null}
      onOpenChange={onOpenChange}
      title={`Delete “${group?.title ?? ''}”?`}
      description={
        itemCount
          ? `${countLabel(itemCount, terminology.toLowerCase())} in this group will be deleted too. You can undo right after, or restore from Trash for 30 days.`
          : 'This group is empty. You can undo right after deleting it.'
      }
      confirmLabel="Delete group"
      destructive
      onConfirm={() => group && onConfirm(group)}
    />
  );
}
