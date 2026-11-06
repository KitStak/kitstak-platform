'use client';
import {
  Archive,
  ArrowUpToLine,
  ChevronsDownUp,
  ChevronsUpDown,
  CopyPlus,
  Download,
  FolderInput,
  ListChecks,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Shrink,
  Trash2,
} from 'lucide-react';
import {
  ColorPicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  toLabelColor,
} from '@/components/ui';
import type { GroupDto } from '@/server/services/contracts/dto';
import { generateKeyBetween } from 'fractional-indexing';
import { useTableStore } from '../state/table-store';
import { useTable } from '../table-context';

/** Group "…" menu (left gutter of the group header / collapsed row). */
export function GroupMenu({
  group,
  itemIds,
}: {
  readonly group: GroupDto;
  readonly itemIds: readonly string[];
}) {
  const { groups, actions, canEdit, exportItems, openMoveToBoard, confirmDeleteGroup } = useTable();
  const collapsed = useTableStore((state) => state.collapsedGroups.has(group.id));
  const toggleGroup = useTableStore((state) => state.toggleGroup);
  const setCollapsedGroups = useTableStore((state) => state.setCollapsedGroups);
  const setSelection = useTableStore((state) => state.selectMany);
  const setRenameGroup = useTableStore((state) => state.setRenameGroup);
  const index = groups.findIndex((entry) => entry.id === group.id);

  const addGroup = async (where: 'above' | 'below') => {
    const created = await actions.createGroup(
      where === 'above' ? { beforeId: group.id } : { afterId: group.id },
    );
    if (created) setRenameGroup(created.id);
  };

  const moveToTop = () => {
    const first = groups[0];
    if (!first || first.id === group.id) return;
    let position: string;
    try {
      position = generateKeyBetween(null, first.position);
    } catch {
      position = group.position;
    }
    actions.reorderGroup(group, { beforeId: first.id, position });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${group.title} group actions`}
          data-testid="group-menu"
          className="bt-reveal inline-flex size-6 items-center justify-center rounded-sm text-icon hover:bg-hover hover:text-icon-strong focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus active:bg-pressed data-[state=open]:bg-hover"
        >
          <MoreHorizontal aria-hidden className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem
          icon={collapsed ? <ChevronsUpDown aria-hidden /> : <ChevronsDownUp aria-hidden />}
          onSelect={() => toggleGroup(group.id)}
        >
          {collapsed ? 'Expand this group' : 'Collapse this group'}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Shrink aria-hidden />}
          onSelect={() =>
            setCollapsedGroups(groups.filter((entry) => entry.id !== group.id).map((entry) => entry.id))
          }
        >
          Collapse other groups
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<ChevronsDownUp aria-hidden />}
          onSelect={() => setCollapsedGroups(groups.map((entry) => entry.id))}
        >
          Collapse all groups
        </DropdownMenuItem>
        <DropdownMenuItem icon={<ChevronsUpDown aria-hidden />} onSelect={() => setCollapsedGroups([])}>
          Expand all groups
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<ListChecks aria-hidden />}
          disabled={!itemIds.length}
          onSelect={() => setSelection(itemIds)}
        >
          Select all items
        </DropdownMenuItem>
        {canEdit ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Plus aria-hidden />} onSelect={() => void addGroup('above')}>
              Add group above
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Plus aria-hidden />} onSelect={() => void addGroup('below')}>
              Add group below
            </DropdownMenuItem>
            <DropdownMenuItem icon={<CopyPlus aria-hidden />} onSelect={() => actions.duplicateGroup(group)}>
              Duplicate this group
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<ArrowUpToLine aria-hidden />}
              disabled={index === 0}
              onSelect={moveToTop}
            >
              Move to top
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<FolderInput aria-hidden />}
              onSelect={() => openMoveToBoard({ kind: 'group', group })}
            >
              Move to board…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={() => setRenameGroup(group.id)}>
              Rename group
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger icon={<Palette aria-hidden />}>
                Change group color
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="p-3">
                <ColorPicker
                  value={toLabelColor(group.color, 'blue')}
                  onChange={(color) => actions.updateGroup(group, { color })}
                  columns={6}
                  label="Group color"
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        ) : null}
        <DropdownMenuItem
          icon={<Download aria-hidden />}
          disabled={!itemIds.length}
          onSelect={() => exportItems(itemIds, group.title)}
        >
          Export group to CSV
        </DropdownMenuItem>
        {canEdit ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<Archive aria-hidden />}
              onSelect={() => actions.removeGroup(group, 'archive', itemIds.length)}
            >
              Archive group
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="danger"
              icon={<Trash2 aria-hidden />}
              disabled={groups.length <= 1}
              onSelect={() => confirmDeleteGroup(group)}
            >
              Delete group
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
