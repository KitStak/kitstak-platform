'use client';

/**
 * Board toolbar (TB-001…009): New ‹noun› split button · Search · Person · Filter · Sort · Hide ·
 * Group by · "…" (row height, export, header) · "Save to this view". Responsive by its own
 * width: full labels → icon-only → overflow into the "…" menu. Cmd/Ctrl+F focuses search.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  Download,
  EyeOff,
  FolderPlus,
  ListFilter,
  MoreHorizontal,
  PanelTopClose,
  PanelTopOpen,
  Plus,
  Rows3,
  RotateCcw,
  Save,
  Search,
  Upload,
  UserRound,
  Group,
} from 'lucide-react';
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  SearchInput,
  SplitButton,
  Tooltip,
  cn,
} from '@/components/ui';
import type { CellDensity } from '@/features/cells';
import type { ColumnDto, ItemDto, UserSummaryDto, ViewType } from '@/server/services/contracts/dto';
import type { WorkingState } from '../hooks/use-working-state';
import { countRules } from '../lib/filter-model';
import { FilterChips } from './filter-chips';
import { FilterPanel } from './filter-panel';
import { GroupByPanel, HidePanel, PersonPanel, SortPanel } from './toolbar-panels';
import { ToolbarPopover, type ToolbarDisplay } from './toolbar-popover';

type Panel = 'person' | 'filter' | 'sort' | 'hide' | 'group';

export interface BoardToolbarProps {
  readonly viewType: ViewType;
  readonly noun: string;
  readonly canEdit: boolean;
  readonly columns: readonly ColumnDto[];
  readonly users: readonly UserSummaryDto[];
  readonly items: readonly ItemDto[];
  readonly visibleCount: number;
  readonly state: WorkingState;
  readonly canSave: boolean;
  readonly creating: boolean;
  readonly headerCollapsed: boolean;
  readonly onToggleHeader: () => void;
  readonly onNewItem: () => void;
  readonly onNewGroup: () => void;
  readonly onImport: () => void;
  readonly onExport: (format: 'csv' | 'xlsx') => void;
}

const DENSITY: { value: CellDensity; label: string }[] = [
  { value: 'compact', label: 'Compact (32px)' },
  { value: 'default', label: 'Default (36px)' },
  { value: 'comfortable', label: 'Comfortable (40px)' },
];

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(1200);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 1200));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** People who appear in any people column, with how many items each is on. */
function usePeople(items: readonly ItemDto[], columns: readonly ColumnDto[], users: readonly UserSummaryDto[]) {
  return useMemo(() => {
    const keys = columns.filter((column) => column.type === 'people').map((column) => column.key);
    const counts = new Map<string, number>();
    for (const item of items) {
      const seen = new Set<string>();
      for (const key of keys) {
        const ids = (item.values[key] as { ids?: unknown } | undefined)?.ids;
        if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') seen.add(id);
      }
      for (const id of seen) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return users
      .filter((user) => counts.has(user.id))
      .map((user) => ({ ...user, count: counts.get(user.id) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [columns, items, users]);
}

export function BoardToolbar(props: BoardToolbarProps) {
  const { state, noun, viewType } = props;
  const { table, working } = state;
  const [rootRef, width] = useWidth<HTMLDivElement>();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const people = usePeople(props.items, props.columns, props.users);
  const isTable = viewType === 'table';
  const search = table.state.search;

  // Cmd/Ctrl+F focuses board search (only when focus isn't in another editor).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f' || event.shiftKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"], [contenteditable="true"]')) return;
      event.preventDefault();
      setSearchOpen(true);
      requestAnimationFrame(() => searchRef.current?.focus());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const compact = width < 720;
  const iconOnly = width < 1080;
  const display = (priority: 1 | 2): ToolbarDisplay => (compact && priority === 2 ? 'menu' : iconOnly && priority === 2 ? 'icon' : 'full');
  const open = (name: Panel) => panel === name;
  const toggle = (name: Panel) => (next: boolean) => setPanel(next ? name : null);
  const filterCount = countRules(working.filters);
  const selectedPerson = props.users.find((user) => user.id === working.personFilter);
  const searchExpanded = !compact || searchOpen || search.length > 0;

  const personControl = (
    <ToolbarPopover
      open={open('person')}
      onOpenChange={toggle('person')}
      display={display(2)}
      testId="person"
      title="Filter by person"
      label={selectedPerson ? `Person: ${selectedPerson.name}` : 'Person'}
      text="Person"
      width={340}
      active={Boolean(selectedPerson)}
      icon={
        selectedPerson ? (
          <Avatar name={selectedPerson.name} src={selectedPerson.image} colorKey={selectedPerson.id} size="xs" />
        ) : (
          <UserRound aria-hidden />
        )
      }
    >
      <PersonPanel people={people} selected={working.personFilter} onSelect={table.setPersonFilter} noun={noun} />
    </ToolbarPopover>
  );

  const filterControl = (
    <ToolbarPopover
      open={open('filter')}
      onOpenChange={toggle('filter')}
      display={display(1)}
      testId="filter"
      title="Filter"
      label={filterCount ? `Filter, ${filterCount} active` : 'Filter'}
      text="Filter"
      width={640}
      active={filterCount > 0}
      badge={filterCount || undefined}
      icon={<ListFilter aria-hidden />}
    >
      <FilterPanel
        columns={props.columns}
        users={props.users}
        items={props.items}
        filters={working.filters}
        search={search}
        personFilter={working.personFilter}
        visibleCount={props.visibleCount}
        noun={noun}
        onFiltersChange={table.setFilters}
        onToggleValue={table.toggleLabelFilter}
        onClearAll={table.clearFilters}
      />
    </ToolbarPopover>
  );

  const sortControl = isTable ? (
    <ToolbarPopover
      open={open('sort')}
      onOpenChange={toggle('sort')}
      display={display(2)}
      testId="sort"
      title="Sort"
      label={working.sort.length ? `Sort, ${working.sort.length} rules` : 'Sort'}
      text="Sort"
      width={440}
      active={working.sort.length > 0}
      badge={working.sort.length || undefined}
      icon={<ArrowUpDown aria-hidden />}
    >
      <SortPanel columns={props.columns} sort={working.sort} onChange={table.setSort} />
    </ToolbarPopover>
  ) : null;

  const hideControl = isTable ? (
    <ToolbarPopover
      open={open('hide')}
      onOpenChange={toggle('hide')}
      display={display(2)}
      testId="hide"
      title="Hide columns"
      label={working.hiddenColumnKeys.length ? `Hide, ${working.hiddenColumnKeys.length} hidden` : 'Hide'}
      text="Hide"
      width={320}
      active={working.hiddenColumnKeys.length > 0}
      badge={working.hiddenColumnKeys.length || undefined}
      icon={<EyeOff aria-hidden />}
    >
      <HidePanel columns={props.columns} hidden={working.hiddenColumnKeys} onChange={table.setHiddenColumns} />
    </ToolbarPopover>
  ) : null;

  const groupControl = isTable ? (
    <ToolbarPopover
      open={open('group')}
      onOpenChange={toggle('group')}
      display={display(2)}
      testId="group-by"
      title="Group by"
      label={state.groupBy ? 'Group by (active)' : 'Group by'}
      text="Group by"
      width={340}
      active={Boolean(state.groupBy)}
      icon={<Group aria-hidden />}
    >
      <GroupByPanel columns={props.columns} value={state.groupBy} onChange={state.setGroupBy} />
    </ToolbarPopover>
  ) : null;

  const menuPanels: { name: Panel; label: string; icon: React.ReactNode; show: boolean }[] = [
    { name: 'person', label: selectedPerson ? `Person: ${selectedPerson.name}` : 'Person', icon: <UserRound aria-hidden />, show: true },
    { name: 'sort', label: 'Sort', icon: <ArrowUpDown aria-hidden />, show: isTable },
    { name: 'hide', label: 'Hide columns', icon: <EyeOff aria-hidden />, show: isTable },
    { name: 'group', label: 'Group by', icon: <Group aria-hidden />, show: isTable },
  ];

  return (
    <div className="flex flex-col">
      <div
        ref={rootRef}
        role="toolbar"
        aria-label="Board tools"
        data-testid="board-toolbar"
        data-compact={compact || undefined}
        className="relative flex h-12 items-center gap-2 px-8 max-md:px-4"
      >
        {props.canEdit && viewType !== 'form' ? (
          <SplitButton
            onClick={props.onNewItem}
            loading={props.creating}
            leadingIcon={compact ? <Plus aria-hidden /> : undefined}
            menuLabel={`More ways to add ${noun.toLowerCase()}s`}
            className="shrink-0"
            renderMenu={(trigger) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-60" data-testid="new-item-menu">
                  <DropdownMenuItem icon={<Plus aria-hidden />} onSelect={props.onNewItem}>
                    New {noun.toLowerCase()}
                  </DropdownMenuItem>
                  <DropdownMenuItem icon={<FolderPlus aria-hidden />} onSelect={props.onNewGroup} data-testid="new-group">
                    New group of {noun.toLowerCase()}s
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem icon={<Upload aria-hidden />} onSelect={props.onImport}>
                    Import {noun.toLowerCase()}s
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          >
            <span data-testid="new-item">{compact ? 'New' : `New ${noun.toLowerCase()}`}</span>
          </SplitButton>
        ) : null}

        <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border-subtle max-[480px]:hidden" />

        {/* Other view types render their own search in their view bar. */}
        {isTable ? (
          <>
            {searchExpanded ? (
              <SearchInput
                ref={searchRef}
                size="sm"
                value={search}
                onValueChange={table.setSearch}
                onEscape={() => {
                  table.setSearch('');
                  setSearchOpen(false);
                }}
                onBlur={() => !search && setSearchOpen(false)}
                aria-label={`Search ${noun.toLowerCase()}s`}
                placeholder="Search"
                data-testid="board-search"
                containerClassName={cn(
                  'shrink-0 transition-[width] duration-200 ease-out motion-reduce:transition-none',
                  compact ? 'w-40' : search ? 'w-[280px]' : 'w-[200px] focus-within:w-[280px]',
                )}
              />
            ) : (
              <IconButton
                label={`Search ${noun.toLowerCase()}s`}
                icon={<Search aria-hidden />}
                onClick={() => {
                  setSearchOpen(true);
                  requestAnimationFrame(() => searchRef.current?.focus());
                }}
                data-testid="board-search-toggle"
              />
            )}
          </>
        ) : null}
        {viewType === 'form' ? null : (
          <>
            {personControl}
            {filterControl}
            {sortControl}
            {hideControl}
            {groupControl}
          </>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {state.isDirty ? (
            <div className="flex items-center gap-1 animate-fade-in" data-testid="view-dirty">
              {props.canSave ? (
                <Tooltip content="Save these filters, sort, columns and grouping for everyone who opens this view">
                  <Button
                    variant="tertiary"
                    size="sm"
                    leadingIcon={<Save aria-hidden />}
                    onClick={state.save}
                    loading={state.saving}
                    data-testid="save-to-view"
                  >
                    <span className={cn(iconOnly && 'sr-only')}>Save to this view</span>
                  </Button>
                </Tooltip>
              ) : (
                <span className="text-sm text-fg-muted max-sm:hidden">Unsaved changes</span>
              )}
              <IconButton label="Reset to the saved view" size="sm" icon={<RotateCcw aria-hidden />} onClick={state.reset} data-testid="reset-view" />
            </div>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="More view options" icon={<MoreHorizontal aria-hidden />} data-testid="toolbar-more" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60" data-testid="toolbar-more-menu">
              {compact ? (
                <>
                  <DropdownMenuLabel>View tools</DropdownMenuLabel>
                  {menuPanels
                    .filter((entry) => entry.show)
                    .map((entry) => (
                      <DropdownMenuItem key={entry.name} icon={entry.icon} onSelect={() => setPanel(entry.name)}>
                        {entry.label}
                      </DropdownMenuItem>
                    ))}
                  <DropdownMenuSeparator />
                </>
              ) : null}
              {isTable ? (
                <>
                  <DropdownMenuLabel>Row height</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={table.state.density} onValueChange={(value) => table.setDensity(value as CellDensity)}>
                    {DENSITY.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value} data-testid={`density-${option.value}`}>
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem icon={<Download aria-hidden />} onSelect={() => props.onExport('xlsx')}>
                Export view to Excel
              </DropdownMenuItem>
              <DropdownMenuItem icon={<Rows3 aria-hidden />} onSelect={() => props.onExport('csv')}>
                Export view to CSV
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                icon={props.headerCollapsed ? <PanelTopOpen aria-hidden /> : <PanelTopClose aria-hidden />}
                onSelect={props.onToggleHeader}
              >
                {props.headerCollapsed ? 'Expand board header' : 'Collapse board header'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <FilterChips state={state} columns={props.columns} users={props.users} onOpenFilter={() => setPanel('filter')} />
    </div>
  );
}

