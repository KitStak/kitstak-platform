'use client';
import { useRouter } from 'next/navigation';
import { FolderPlus, LayoutDashboard, LayoutTemplate, Plus, Table2, Upload } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from '@/components/ui';
import { useCan, useOrg } from '../org-context';
import { routes } from '../routes';
import { useShellStore } from '../store';

export interface AddMenuProps {
  readonly workspaceId: string | null;
  readonly folderId?: string | null;
}

/** Quiet "+" next to the workspace switcher: create board / dashboard / folder, or import. */
export function AddMenu({ workspaceId, folderId = null }: AddMenuProps) {
  const router = useRouter();
  const { org } = useOrg();
  const requestCreate = useShellStore((state) => state.requestCreate);
  const canCreateBoard = useCan('board:create');
  const canWriteWorkspace = useCan('workspace:write');
  const canWriteDashboard = useCan('dashboard:write');
  const canImport = useCan('data:import');
  const disabled = !workspaceId || !(canCreateBoard || canWriteWorkspace || canWriteDashboard || canImport);
  const target = workspaceId ?? undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label="Add to workspace"
          icon={<Plus aria-hidden strokeWidth={2.25} />}
          variant="ghost"
          size="md"
          data-testid="sidebar-add"
          className="rounded-md text-icon-strong data-[state=open]:bg-selected data-[state=open]:text-primary-text"
          disabled={disabled}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Add to this workspace</DropdownMenuLabel>
        <DropdownMenuItem
          icon={<Table2 aria-hidden className="!text-primary" />}
          description="Deals, leads, contacts or anything"
          disabled={!canCreateBoard}
          onSelect={() => requestCreate({ kind: 'board', workspaceId: target, folderId })}
        >
          New board
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<LayoutDashboard aria-hidden className="!text-[var(--label-teal-text)]" />}
          description="Charts and KPIs across boards"
          disabled={!canWriteDashboard}
          onSelect={() => requestCreate({ kind: 'dashboard', workspaceId: target })}
        >
          New dashboard
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<FolderPlus aria-hidden className="!text-[var(--label-orange-text)]" />}
          disabled={!canWriteWorkspace}
          onSelect={() => requestCreate({ kind: 'folder', workspaceId: target, folderId })}
        >
          New folder
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<LayoutTemplate aria-hidden className="!text-[var(--label-purple)]" />}
          description="CRM, sales, ops and HR boards"
          disabled={!canCreateBoard}
          onSelect={() => requestCreate({ kind: 'board', workspaceId: target, folderId, mode: 'templates' })}
        >
          Choose from templates
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Upload aria-hidden />}
          description="CSV or Excel"
          disabled={!canImport}
          onSelect={() => router.push(routes.importData(org.slug))}
        >
          Import data
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
