'use client';

/** Header "…" menu: copy link, open in new tab, duplicate, move, print, archive, delete. */
import { Archive, ArrowRightLeft, Copy, CopyPlus, ExternalLink, FolderInput, Maximize2, Minimize2, MoreHorizontal, Printer, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
  labelColorVars,
  toLabelColor,
} from '@/components/ui';
import { useBoards } from '@/lib/hooks';
import type { GroupDto, ItemDto } from '@/server/services/contracts/dto';

export interface ItemMenuProps {
  readonly item: ItemDto;
  readonly term: string;
  readonly groups: readonly GroupDto[];
  readonly canEdit: boolean;
  readonly onCopyLink: () => void;
  readonly onOpenInNewTab: () => void;
  readonly onDuplicate: () => void;
  readonly onMoveToGroup: (group: GroupDto) => void;
  readonly onMoveToBoard: (boardId: string, boardName: string) => void;
  readonly onPrint: () => void;
  readonly onArchive: () => void;
  readonly onDelete: () => void;
  /** Full-page toggle, offered here because the header icon hides on narrow panels. */
  readonly expanded?: boolean;
  readonly onToggleExpanded?: () => void;
}

function BoardTargets({ item, onMoveToBoard }: { readonly item: ItemDto; readonly onMoveToBoard: (id: string, name: string) => void }) {
  const boards = useBoards();
  const targets = (boards.data ?? []).filter((board) => board.id !== item.boardId && !board.archivedAt);
  if (boards.isLoading) return <p className="px-2.5 py-2 text-sm text-fg-muted">Loading boards…</p>;
  if (targets.length === 0) return <p className="px-2.5 py-2 text-sm text-fg-muted">No other boards</p>;
  return (
    <>
      {targets.slice(0, 30).map((board) => (
        <DropdownMenuItem key={board.id} onSelect={() => onMoveToBoard(board.id, board.name)}>
          {board.name}
        </DropdownMenuItem>
      ))}
    </>
  );
}

export function ItemMenu(props: ItemMenuProps) {
  const { item, term, groups, canEdit } = props;
  const isSub = item.parentItemId !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`${term} actions`} icon={<MoreHorizontal aria-hidden />} data-testid="item-panel-menu" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem icon={<Copy aria-hidden />} onSelect={props.onCopyLink}>
          Copy link
        </DropdownMenuItem>
        <DropdownMenuItem icon={<ExternalLink aria-hidden />} onSelect={props.onOpenInNewTab}>
          Open in new tab
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Printer aria-hidden />} onSelect={props.onPrint}>
          Print
        </DropdownMenuItem>
        {props.onToggleExpanded ? (
          <DropdownMenuItem
            icon={props.expanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
            onSelect={props.onToggleExpanded}
            data-testid="item-menu-expand"
          >
            {props.expanded ? 'Collapse to side panel' : 'Expand to full page'}
          </DropdownMenuItem>
        ) : null}
        {canEdit ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<CopyPlus aria-hidden />} onSelect={props.onDuplicate}>
              Duplicate {term.toLowerCase()}
            </DropdownMenuItem>
            {!isSub ? (
              <>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger icon={<FolderInput aria-hidden />}>Move to group</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-56">
                    <DropdownMenuLabel>Groups</DropdownMenuLabel>
                    {groups.map((group) => (
                      <DropdownMenuItem
                        key={group.id}
                        disabled={group.id === item.groupId}
                        icon={<span aria-hidden className="size-3 rounded-full" style={{ background: labelColorVars(toLabelColor(group.color, 'blue')).bg }} />}
                        onSelect={() => props.onMoveToGroup(group)}
                      >
                        {group.title}
                        {group.id === item.groupId ? ' (current)' : ''}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger icon={<ArrowRightLeft aria-hidden />}>Move to board</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-80 w-60">
                    <DropdownMenuLabel>Boards</DropdownMenuLabel>
                    <BoardTargets item={item} onMoveToBoard={props.onMoveToBoard} />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Archive aria-hidden />} onSelect={props.onArchive}>
              Archive
            </DropdownMenuItem>
            <DropdownMenuItem variant="danger" icon={<Trash2 aria-hidden />} onSelect={props.onDelete}>
              Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
