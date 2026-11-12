'use client';
import { useState } from 'react';
import { Command } from 'cmdk';
import { Check, ChevronDown, Lock, Plus, Search } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  cn,
  labelColorVars,
  toLabelColor,
} from '@/components/ui';
import type { WorkspaceDto } from '../api';

export function WorkspaceTile({
  workspace,
  size = 28,
}: {
  readonly workspace: Pick<WorkspaceDto, 'name' | 'color' | 'icon'>;
  readonly size?: number;
}) {
  const color = labelColorVars(toLabelColor(workspace.color, 'blue'));
  const initial = workspace.name.trim().charAt(0).toUpperCase() || 'W';
  const icon = workspace.icon && !/^[a-z0-9-]+$/i.test(workspace.icon) ? workspace.icon : null; // emoji only
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-md font-semibold shadow-xs"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.48),
        background: color.bg,
        color: color.fg,
      }}
    >
      {icon ?? initial}
    </span>
  );
}

export interface WorkspaceSwitcherProps {
  readonly workspaces: readonly WorkspaceDto[] | undefined;
  readonly loading: boolean;
  readonly activeId: string | null;
  readonly onSelect: (workspaceId: string) => void;
  readonly onCreate?: () => void;
  /** The active workspace's overview page is open: the card shows the selected nav state. */
  readonly selected?: boolean;
}

/** Card-like trigger showing the active workspace; opens a searchable list of workspaces. */
export function WorkspaceSwitcher({
  workspaces,
  loading,
  activeId,
  onSelect,
  onCreate,
  selected = false,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const active = workspaces?.find((workspace) => workspace.id === activeId) ?? null;

  if (loading && !workspaces) {
    return (
      <div
        className="flex h-10 items-center gap-2.5 rounded-lg px-2"
        role="status"
        aria-busy="true"
        aria-label="Loading workspaces"
      >
        <Skeleton width={28} height={28} rounded="md" />
        <Skeleton width="60%" height={10} rounded="full" />
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={active ? `Workspace: ${active.name}. Switch workspace` : 'Choose a workspace'}
          aria-current={selected ? 'page' : undefined}
          data-selected={selected || undefined}
          data-testid="workspace-switcher"
          className={cn(
            'group flex h-10 w-full min-w-0 items-center gap-2.5 rounded-lg border border-transparent bg-panel px-1.5 text-left shadow-xs',
            'transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)]',
            'hover:border-border-default focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:border-primary',
            selected && 'border-primary/40 bg-primary-selected text-primary-text hover:border-primary',
          )}
        >
          {active ? (
            <WorkspaceTile workspace={active} />
          ) : (
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-muted text-fg-muted">
              ?
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            {active?.name ?? 'Select workspace'}
          </span>
          {active?.kind === 'closed' ? (
            <Lock aria-label="Closed workspace" className="size-3.5 shrink-0 text-icon" />
          ) : null}
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 text-icon transition-transform duration-[var(--duration-fast)] group-data-[state=open]:rotate-180"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent flush align="start" className="w-[320px]">
        <Command loop label="Workspaces">
          <div className="flex items-center gap-2 border-b border-border-subtle px-3">
            <Search aria-hidden className="size-4 text-icon" />
            <Command.Input
              autoFocus
              placeholder="Search workspaces"
              className="h-10 flex-1 bg-transparent text-base outline-none"
            />
          </div>
          <Command.List className="max-h-[320px] overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-6 text-center text-sm text-fg-muted">
              No workspaces match
            </Command.Empty>
            <Command.Group
              heading="My workspaces"
              className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-1 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-muted"
            >
              {(workspaces ?? []).map((workspace) => (
                <Command.Item
                  key={workspace.id}
                  value={`${workspace.name} ${workspace.id}`}
                  onSelect={() => {
                    onSelect(workspace.id);
                    setOpen(false);
                  }}
                  className="ks-menu-item"
                >
                  <WorkspaceTile workspace={workspace} size={24} />
                  <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                  {workspace.kind === 'closed' ? <Lock aria-label="Closed" className="!size-3.5" /> : null}
                  {workspace.id === activeId ? (
                    <Check aria-label="Current" className="!text-primary-text" />
                  ) : null}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
          {onCreate ? (
            <div className="border-t border-border-subtle p-1.5">
              <button
                type="button"
                className="ks-menu-item w-full text-primary-text hover:bg-primary-subtle focus-visible:bg-primary-subtle"
                onClick={() => {
                  setOpen(false);
                  onCreate();
                }}
              >
                <Plus aria-hidden className="!text-primary-text" />
                Add workspace
              </button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
