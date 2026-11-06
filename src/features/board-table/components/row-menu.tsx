'use client';
import {
  Archive,
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  CopyPlus,
  FolderInput,
  Link2,
  ListTree,
  Maximize2,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  toast,
} from '@/components/ui';
import type { ItemDto } from '@/server/services/contracts/dto';
import { useTableStore } from '../state/table-store';
import { groupColorVar, useTable } from '../table-context';

/** Row "…" menu in the left gutter (outside the grid). */
export function RowMenu({ item, variant }: { readonly item: ItemDto; readonly variant: 'item' | 'subitem' }) {
  const { actions, groups, onOpenItem, terminology, canEdit, openMoveToBoard } = useTable();
  const toggleExpanded = useTableStore((state) => state.toggleExpanded);
  const noun = variant === 'subitem' ? 'subitem' : terminology.toLowerCase();
  const isTemp = item.id.startsWith('temp-');

  const copyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?item=${encodeURIComponent(item.id)}`;
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.success('Link copied'))
      .catch(() => toast.error("Couldn't copy the link", 'Your browser blocked clipboard access.'));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={isTemp}>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${item.name} actions`}
          data-testid="row-menu"
          className="bt-reveal inline-flex size-6 items-center justify-center rounded-sm text-icon hover:bg-hover hover:text-icon-strong focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus active:bg-pressed data-[state=open]:bg-hover"
        >
          <MoreHorizontal aria-hidden className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuItem
          icon={<Maximize2 aria-hidden />}
          onSelect={() => onOpenItem(item.id)}
          shortcut="Ctrl ↵"
        >
          Open {noun}
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Link2 aria-hidden />} onSelect={copyLink}>
          Copy link
        </DropdownMenuItem>
        {canEdit ? (
          <>
            <DropdownMenuSeparator />
            {variant === 'item' ? (
              <>
                <DropdownMenuItem
                  icon={<ArrowUpToLine aria-hidden />}
                  onSelect={() => actions.createItem(item.groupId, `New ${noun}`, { beforeId: item.id })}
                >
                  Create new {noun} above
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon={<ArrowDownToLine aria-hidden />}
                  onSelect={() => actions.createItem(item.groupId, `New ${noun}`, { afterId: item.id })}
                >
                  Create new {noun} below
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon={<ListTree aria-hidden />}
                  onSelect={() => toggleExpanded(item.id, true)}
                >
                  Add subitem
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuItem
              icon={<CopyPlus aria-hidden />}
              onSelect={() => actions.duplicateItems([item.id])}
            >
              Duplicate {noun}
            </DropdownMenuItem>
            {variant === 'item' ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger icon={<FolderInput aria-hidden />}>Move to</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  {groups.map((group) => (
                    <DropdownMenuItem
                      key={group.id}
                      disabled={group.id === item.groupId}
                      onSelect={() => actions.moveToGroup([item.id], group)}
                      icon={
                        <span
                          aria-hidden
                          className="size-3 rounded-full"
                          style={{ background: groupColorVar(group.color) }}
                        />
                      }
                    >
                      {group.title}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    icon={<Copy aria-hidden />}
                    onSelect={() => openMoveToBoard({ kind: 'items', itemIds: [item.id] })}
                  >
                    Another board…
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<Archive aria-hidden />}
              onSelect={() => actions.removeItems([item.id], 'archive')}
            >
              Archive
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="danger"
              icon={<Trash2 aria-hidden />}
              onSelect={() => actions.removeItems([item.id], 'delete')}
            >
              Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
