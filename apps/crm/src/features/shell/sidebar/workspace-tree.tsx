'use client';
/**
 * Folder / board / dashboard tree of one workspace: filtering with highlight, current-page reveal,
 * full "…" menus (tree-menus.tsx), inline rename (double-click / F2 / menu) and drag-and-drop
 * reorder + move-into-folder for boards and folders (dnd-kit, rules in tree-dnd.ts).
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { ChevronRight, Lock, Plus, Share2 } from 'lucide-react';
import { Button, EmptyState, SkeletonRows, cn } from '@/components/ui';
import { useWorkspaceTree, type BoardSummaryDto, type FolderDto, type WorkspaceTreeDto } from '../api';
import { EntityIcon } from '../entity-icon';
import { FolderGlyph } from '../folder-icon';
import { useCan, useOrg } from '../org-context';
import { routes } from '../routes';
import { useShellStore } from '../store';
import { Highlight, NavRow, ROW_INDENT_PX } from './nav-row';
import { useTreeActions, type TreeActions } from './tree-actions';
import { dropPositionFor, resolveDrop, type DragNode, type DropPosition } from './tree-dnd';
import { BoardMenu, DashboardMenu, FolderMenu } from './tree-menus';
import { ancestorFolderIds, buildTree, filterTree, sortTreeAlpha, type TreeNode } from './tree-model';

const AUTO_EXPAND_MS = 600;

interface TreeContextValue {
  readonly tree: WorkspaceTreeDto;
  readonly actions: TreeActions;
  readonly query: string;
  readonly expanded: ReadonlySet<string>;
  readonly pathname: string;
  readonly renamingId: string | null;
  readonly setRenamingId: (id: string | null) => void;
  readonly drop: { readonly id: string; readonly position: DropPosition } | null;
  readonly draggingId: string | null;
  readonly canDrag: boolean;
}

const TreeContext = createContext<TreeContextValue | null>(null);

function useTree(): TreeContextValue {
  const value = useContext(TreeContext);
  if (!value) throw new Error('Tree rows must render inside <WorkspaceTree>');
  return value;
}

/** In-place rename field: same height and inset as the row, Enter saves, Esc / empty reverts. */
function RenameField({
  initial,
  depth,
  icon,
  onDone,
}: {
  readonly initial: string;
  readonly depth: number;
  readonly icon: ReactNode;
  readonly onDone: (value: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    const trimmed = next?.trim() ?? '';
    onDone(trimmed && trimmed !== initial ? trimmed : null);
  };
  return (
    <div className="flex h-8 items-center gap-2 rounded-sm pr-1" style={{ paddingLeft: 8 + depth * ROW_INDENT_PX }}>
      <span aria-hidden className="-ml-1 w-3.5 shrink-0" />
      <span className="flex size-5 shrink-0 items-center justify-center text-icon">{icon}</span>
      <input
        autoFocus
        aria-label="Name"
        value={value}
        maxLength={255}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => finish(value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') finish(value);
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finish(null);
          }
        }}
        className="h-7 min-w-0 flex-1 rounded-sm border border-primary bg-panel px-1.5 text-base text-fg shadow-[0_0_0_3px_var(--focus-ring-soft)] outline-none"
      />
    </div>
  );
}

/** Drag source + drop target wrapper with insertion line / folder highlight. */
function DnDRow({ node, children }: { readonly node: DragNode; readonly children: ReactNode }) {
  const { drop, draggingId, canDrag } = useTree();
  const draggable = node.type !== 'dashboard' && canDrag;
  const drag = useDraggable({ id: node.id, data: node, disabled: !draggable });
  const dropZone = useDroppable({ id: node.id, data: node, disabled: !canDrag });
  const position = drop?.id === node.id && draggingId !== node.id ? drop.position : null;
  return (
    <div
      ref={(element) => {
        drag.setNodeRef(element);
        dropZone.setNodeRef(element);
      }}
      {...(draggable ? drag.listeners : {})}
      {...(draggable ? drag.attributes : {})}
      role={undefined}
      tabIndex={undefined}
      aria-roledescription={undefined}
      data-drop={position ?? undefined}
      className={cn(
        'relative rounded-sm',
        drag.isDragging && 'opacity-40',
        position === 'inside' && 'bg-highlight ring-1 ring-primary ring-inset',
        position === 'before' && 'before:absolute before:inset-x-1 before:-top-px before:z-[1] before:h-0.5 before:rounded-full before:bg-primary',
        position === 'after' && 'after:absolute after:inset-x-1 after:-bottom-px after:z-[1] after:h-0.5 after:rounded-full after:bg-primary',
      )}
    >
      {children}
    </div>
  );
}

function FolderRow({ node, depth }: { readonly node: Extract<TreeNode, { type: 'folder' }>; readonly depth: number }) {
  const { tree, query, expanded, actions, renamingId, setRenamingId } = useTree();
  const toggleFolder = useShellStore((state) => state.toggleFolder);
  const isOpen = query ? true : expanded.has(node.id);
  const folder = node.folder;
  const icon = <FolderGlyph folderId={folder.id} open={isOpen} color={folder.color} />;
  return (
    <li>
      {renamingId === folder.id ? (
        <RenameField
          initial={folder.name}
          depth={depth}
          icon={icon}
          onDone={(name) => {
            setRenamingId(null);
            if (name) void actions.renameFolder(folder.id, name);
          }}
        />
      ) : (
        <DnDRow node={{ id: folder.id, type: 'folder', parentId: folder.parentId }}>
          <NavRow
            depth={depth}
            onClick={() => toggleFolder(folder.id)}
            onDoubleClick={() => setRenamingId(folder.id)}
            onKeyDown={(event) => onRowKey(event, () => setRenamingId(folder.id))}
            aria-expanded={isOpen}
            icon={icon}
            label={<Highlight text={folder.name} query={query} />}
            title={folder.name}
            testId="sidebar-folder"
            leading={
              <ChevronRight
                aria-hidden
                className={cn(
                  '-ml-1 size-3.5 shrink-0 text-icon transition-transform duration-[var(--duration-normal)] ease-[var(--ease-out)]',
                  isOpen && 'rotate-90',
                )}
              />
            }
            actions={<FolderMenu folder={folder} folders={tree.folders} actions={actions} onRename={() => setRenamingId(folder.id)} />}
          />
        </DnDRow>
      )}
      {isOpen && node.children.length > 0 ? (
        <div className="animate-fade-in">
          <NodeList nodes={node.children} depth={depth + 1} />
        </div>
      ) : null}
      {isOpen && node.children.length === 0 ? (
        <p className="py-1 text-sm text-fg-muted" style={{ paddingLeft: 8 + (depth + 1) * ROW_INDENT_PX + 28 }}>
          Drag boards here
        </p>
      ) : null}
    </li>
  );
}

function onRowKey(event: ReactKeyboardEvent, rename: () => void) {
  if (event.key === 'F2') {
    event.preventDefault();
    rename();
  }
}

function BoardRow({ board, depth }: { readonly board: BoardSummaryDto; readonly depth: number }) {
  const { org } = useOrg();
  const { tree, query, pathname, actions, renamingId, setRenamingId } = useTree();
  const canWrite = useCan('board:write');
  const href = routes.board(org.slug, board.id);
  const icon = <EntityIcon type="board" boardKind={board.kind} />;
  if (renamingId === board.id) {
    return (
      <li>
        <RenameField
          initial={board.name}
          depth={depth}
          icon={icon}
          onDone={(name) => {
            setRenamingId(null);
            if (name) void actions.renameBoard(board.id, name);
          }}
        />
      </li>
    );
  }
  return (
    <li>
      <DnDRow node={{ id: board.id, type: 'board', parentId: board.folderId }}>
        <NavRow
          href={href}
          depth={depth}
          active={pathname === href || pathname.startsWith(`${href}/`)}
          title={board.name}
          testId="sidebar-board-link"
          onDoubleClick={canWrite ? () => setRenamingId(board.id) : undefined}
          onKeyDown={(event) => canWrite && onRowKey(event, () => setRenamingId(board.id))}
          icon={icon}
          label={<Highlight text={board.name} query={query} />}
          leading={<span aria-hidden className="-ml-1 w-3.5 shrink-0" />}
          meta={
            board.privacy === 'private' ? (
              <Lock aria-label="Private board" className="size-3" />
            ) : board.privacy === 'shareable' ? (
              <Share2 aria-label="Shareable board" className="size-3" />
            ) : null
          }
          actions={
            <BoardMenu
              board={board}
              href={href}
              folders={tree.folders}
              actions={actions}
              onRename={() => setRenamingId(board.id)}
            />
          }
        />
      </DnDRow>
    </li>
  );
}

function DashboardRow({ id, name, depth }: { readonly id: string; readonly name: string; readonly depth: number }) {
  const { org } = useOrg();
  const { query, pathname, actions, renamingId, setRenamingId } = useTree();
  const href = routes.dashboard(org.slug, id);
  const icon = <EntityIcon type="dashboard" />;
  if (renamingId === id) {
    return (
      <li>
        <RenameField
          initial={name}
          depth={depth}
          icon={icon}
          onDone={(next) => {
            setRenamingId(null);
            if (next) void actions.renameDashboard(id, next);
          }}
        />
      </li>
    );
  }
  return (
    <li>
      <DnDRow node={{ id, type: 'dashboard', parentId: null }}>
        <NavRow
          href={href}
          depth={depth}
          active={pathname === href || pathname.startsWith(`${href}/`)}
          title={name}
          testId="sidebar-dashboard-link"
          onDoubleClick={() => setRenamingId(id)}
          onKeyDown={(event) => onRowKey(event, () => setRenamingId(id))}
          icon={icon}
          label={<Highlight text={name} query={query} />}
          leading={<span aria-hidden className="-ml-1 w-3.5 shrink-0" />}
          actions={<DashboardMenu id={id} name={name} href={href} actions={actions} onRename={() => setRenamingId(id)} />}
        />
      </DnDRow>
    </li>
  );
}

function NodeList({ nodes, depth }: { readonly nodes: readonly TreeNode[]; readonly depth: number }) {
  return (
    <ul data-nested={depth === 0 ? undefined : ''} className="flex flex-col gap-px">
      {nodes.map((node) => {
        if (node.type === 'folder') return <FolderRow key={node.id} node={node} depth={depth} />;
        if (node.type === 'board') return <BoardRow key={node.id} board={node.board} depth={depth} />;
        return <DashboardRow key={node.id} id={node.id} name={node.dashboard.name} depth={depth} />;
      })}
    </ul>
  );
}

function DragPreview({ node, tree }: { readonly node: DragNode; readonly tree: WorkspaceTreeDto }) {
  const folder: FolderDto | undefined = node.type === 'folder' ? tree.folders.find((f) => f.id === node.id) : undefined;
  const board = node.type === 'board' ? tree.boards.find((b) => b.id === node.id) : undefined;
  return (
    <div className="flex h-8 w-56 items-center gap-2 rounded-sm border border-border-subtle bg-raised px-2 text-base text-fg shadow-md">
      {folder ? <FolderGlyph folderId={folder.id} color={folder.color} /> : <EntityIcon type="board" boardKind={board?.kind} />}
      <span className="truncate">{folder?.name ?? board?.name}</span>
    </div>
  );
}

export interface WorkspaceTreeProps {
  readonly workspaceId: string | null;
  readonly query: string;
}

/** Folder/board/dashboard tree of the active workspace, with filtering and current-page reveal. */
export function WorkspaceTree({ workspaceId, query }: WorkspaceTreeProps) {
  const { org } = useOrg();
  const pathname = usePathname() ?? '';
  const tree = useWorkspaceTree(org.id, workspaceId);
  const expandedList = useShellStore((state) => state.expandedFolders);
  const expandFolders = useShellStore((state) => state.expandFolders);
  const requestCreate = useShellStore((state) => state.requestCreate);
  const canCreateBoard = useCan('board:create');
  const canWrite = useCan('board:write');
  const actions = useTreeActions(org.id, workspaceId ?? 'none');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; position: DropPosition } | null>(null);
  const [dragging, setDragging] = useState<DragNode | null>(null);
  const expandTimer = useRef<{ id: string; timer: number } | null>(null);
  const suppressClick = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const sortMode = useShellStore((state) => (workspaceId ? state.treeSortByWorkspace[workspaceId] : undefined) ?? 'manual');
  const nodes = useMemo(() => {
    if (!tree.data) return [];
    const built = buildTree(tree.data);
    return sortMode === 'alpha' ? sortTreeAlpha(built) : built;
  }, [tree.data, sortMode]);
  const filtered = useMemo(() => filterTree(nodes, query), [nodes, query]);
  const expanded = useMemo(() => new Set(expandedList), [expandedList]);

  // Reveal the board being viewed.
  const currentBoardId = /\/boards\/([0-9a-f-]{36})/i.exec(pathname)?.[1] ?? null;
  useEffect(() => {
    if (tree.data && currentBoardId) expandFolders(ancestorFolderIds(tree.data, currentBoardId));
  }, [tree.data, currentBoardId, expandFolders]);

  const clearExpandTimer = () => {
    if (expandTimer.current) window.clearTimeout(expandTimer.current.timer);
    expandTimer.current = null;
  };

  const onDragStart = (event: DragStartEvent) => {
    setDragging(event.active.data.current as DragNode);
    suppressClick.current = true;
  };
  const onDragMove = (event: DragMoveEvent) => {
    const over = event.over;
    const pointer = event.activatorEvent as PointerEvent | MouseEvent;
    if (!over || !('clientY' in pointer)) {
      setDrop(null);
      clearExpandTimer();
      return;
    }
    const overNode = over.data.current as DragNode;
    const position = dropPositionFor(overNode.type, pointer.clientY + event.delta.y, over.rect);
    setDrop((current) => (current?.id === over.id && current.position === position ? current : { id: String(over.id), position }));
    if (overNode.type === 'folder' && position === 'inside' && !expanded.has(overNode.id)) {
      if (expandTimer.current?.id !== overNode.id) {
        clearExpandTimer();
        expandTimer.current = {
          id: overNode.id,
          timer: window.setTimeout(() => expandFolders([overNode.id]), AUTO_EXPAND_MS),
        };
      }
    } else {
      clearExpandTimer();
    }
  };
  const onDragEnd = (event: DragEndEvent) => {
    clearExpandTimer();
    const target = drop;
    setDrop(null);
    setDragging(null);
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    if (!tree.data || !event.over || !target) return;
    const move = resolveDrop(
      tree.data,
      event.active.data.current as DragNode,
      event.over.data.current as DragNode,
      target.position,
    );
    if (!move) return;
    // Reveal where it landed: expand the destination folder.
    const destination = move.type === 'board' ? move.folderId : move.parentId;
    if (destination) expandFolders([destination]);
    void actions.move(move);
  };

  if (!workspaceId) return null;
  if (tree.isPending) return <SkeletonRows rows={5} className="px-1" />;
  if (tree.isError) {
    return (
      <div
        role="alert"
        className="mx-1 flex flex-col items-start gap-2 rounded-md bg-danger-subtle p-3 text-sm text-danger-text"
      >
        <span>We couldn&apos;t load this workspace.</span>
        <Button size="xs" variant="secondary" onClick={() => void tree.refetch()} loading={tree.isFetching}>
          Try again
        </Button>
      </div>
    );
  }
  if (nodes.length === 0) {
    return (
      <EmptyState
        size="sm"
        illustration="board"
        title="No boards yet"
        actions={
          canCreateBoard ? (
            <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => requestCreate({ kind: 'board', workspaceId })}>
              New board
            </Button>
          ) : null
        }
      />
    );
  }
  if (query && filtered.nodes.length === 0) {
    return <p className="px-3 py-4 text-center text-sm text-fg-muted">No boards match “{query}”</p>;
  }

  const context: TreeContextValue = {
    tree: tree.data,
    actions,
    query,
    expanded,
    pathname,
    renamingId,
    setRenamingId,
    drop,
    draggingId: dragging?.id ?? null,
    // Drag reorder edits the manual order, so it is off while the tree is shown A–Z.
    canDrag: canWrite && !query && sortMode === 'manual',
  };

  return (
    <TreeContext.Provider value={context}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          clearExpandTimer();
          setDrop(null);
          setDragging(null);
          suppressClick.current = false;
        }}
      >
        <nav
          aria-label="Workspace boards"
          data-testid="workspace-tree"
          onClickCapture={(event) => {
            if (suppressClick.current) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          <NodeList nodes={filtered.nodes} depth={0} />
        </nav>
        <DragOverlay dropAnimation={null}>{dragging ? <DragPreview node={dragging} tree={tree.data} /> : null}</DragOverlay>
      </DndContext>
    </TreeContext.Provider>
  );
}
