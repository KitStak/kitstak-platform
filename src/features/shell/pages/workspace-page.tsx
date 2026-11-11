'use client';
/**
 * Workspace overview: breadcrumb, editable header (tile color, name, description), member stack,
 * Add menu and tabs — Content (searchable / filterable / sortable list of folders, boards and
 * dashboards with the same "…" menus as the sidebar) and Members.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Lock, Users } from 'lucide-react';
import {
  AvatarGroup,
  Badge,
  Breadcrumbs,
  Button,
  ColorPicker,
  EmptyState,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toLabelColor,
} from '@/components/ui';
import { useQuery } from '@tanstack/react-query';
import { ApiClientError, apiRequest } from '@/lib/api';
import type { WorkspaceMemberDto } from '@/server/services/shell-workspace';
import { useWorkspaceTree, type WorkspaceDto } from '../api';
import { useCan, useOrg } from '../org-context';
import { routes } from '../routes';
import { AddMenu } from '../sidebar/add-menu';
import { WorkspaceMenu, useWorkspaceMutations } from '../sidebar/workspace-menu';
import { WorkspaceTile } from '../sidebar/workspace-switcher';
import { WorkspaceContentTab } from './workspace-content';
import { WorkspaceMembersTab } from './workspace-members';
import { useWorkspaceUrlState } from './use-workspace-url-state';
import type { WorkspaceTab } from './workspace-url-model';

export function useWorkspaceMembers(orgId: string, workspaceId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'workspaces', workspaceId, 'members'] as const,
    queryFn: ({ signal }) =>
      apiRequest<WorkspaceMemberDto[]>(`/shell/workspaces/${workspaceId}/members`, { orgId, signal }),
    staleTime: 30_000,
  });
}

/**
 * Borderless textarea that grows with its content. It shares the display button's padding,
 * border width and line-height, so entering edit mode never shifts the layout.
 */
function AutoGrowTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { className, ...rest } = props;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = '0px';
    const borders = element.offsetHeight - element.clientHeight;
    element.style.height = `${element.scrollHeight + borders}px`;
  }, [props.value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      {...rest}
      className={`${className ?? ''} -mx-1.5 block w-full resize-none overflow-hidden rounded-sm border border-transparent bg-transparent px-1.5 outline-none focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--focus-ring-soft)]`}
    />
  );
}

/** Text that turns into a field on click / Enter; Enter or blur saves, Esc reverts. */
function InlineEdit({
  value,
  placeholder,
  onSave,
  disabled,
  multiline,
  className,
  inputClassName,
  label,
  startEditing,
}: {
  readonly value: string;
  readonly placeholder: string;
  readonly onSave: (next: string) => void;
  readonly disabled?: boolean;
  readonly multiline?: boolean;
  readonly className: string;
  readonly inputClassName: string;
  readonly label: string;
  readonly startEditing?: boolean;
}) {
  const [editing, setEditing] = useState(Boolean(startEditing));
  const [draft, setDraft] = useState(value);
  const committed = useRef(false);

  const finish = (save: boolean) => {
    if (committed.current) return;
    committed.current = true;
    setEditing(false);
    const next = draft.trim();
    if (save && next !== value.trim() && (next || multiline)) onSave(next);
    else setDraft(value);
  };

  if (editing && !disabled) {
    const common = {
      autoFocus: true,
      'aria-label': label,
      value: draft,
      maxLength: multiline ? 2000 : 255,
      onFocus: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => event.currentTarget.select(),
      onBlur: () => finish(true),
      className: `${inputClassName} w-full rounded-sm border border-primary bg-panel px-1.5 outline-none shadow-[0_0_0_3px_var(--focus-ring-soft)]`,
    };
    return multiline ? (
      <AutoGrowTextarea
        {...common}
        className={inputClassName}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            finish(true);
          }
          if (event.key === 'Escape') finish(false);
        }}
      />
    ) : (
      <input
        {...common}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') finish(true);
          if (event.key === 'Escape') finish(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        committed.current = false;
        setDraft(value);
        setEditing(true);
      }}
      title={disabled ? undefined : `Edit ${label.toLowerCase()}`}
      className={`${className} -mx-1.5 block max-w-full rounded-sm border border-transparent px-1.5 text-left transition-colors enabled:hover:border-border-default focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-default`}
    >
      {value || <span className="text-fg-muted">{placeholder}</span>}
    </button>
  );
}

function Header({ workspace }: { readonly workspace: WorkspaceDto }) {
  const { org } = useOrg();
  const canWrite = useCan('workspace:write');
  const { update } = useWorkspaceMutations(org.id);
  const members = useWorkspaceMembers(org.id, workspace.id);
  const params = useSearchParams();
  const [renameKey, setRenameKey] = useState(0);
  const startRename = params?.get('rename') === '1';
  const people = (members.data ?? []).map((member) => ({ id: member.userId, name: member.name, src: member.image }));

  return (
    <header className="flex flex-wrap items-start gap-5">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={!canWrite}
            aria-label="Change workspace color"
            className="group relative shrink-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-default"
          >
            <WorkspaceTile workspace={workspace} size={64} />
            {canWrite ? (
              <span className="absolute inset-0 flex items-center justify-center rounded-md bg-overlay/0 text-xs font-semibold text-transparent transition-colors group-hover:bg-overlay/50 group-hover:text-white">
                Edit
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-3">
          <p className="mb-2 text-xs font-semibold text-fg-muted">Workspace color</p>
          <ColorPicker
            value={toLabelColor(workspace.color, 'blue')}
            columns={6}
            size="sm"
            label="Workspace color"
            colors={['blue', 'dark-blue', 'indigo', 'purple', 'pink', 'berry', 'red', 'peach', 'orange', 'brown', 'green', 'teal']}
            onChange={(color) => void update(workspace, { color })}
          />
        </PopoverContent>
      </Popover>
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 flex-1">
            <InlineEdit
              key={renameKey}
              label="Workspace name"
              value={workspace.name}
              placeholder="Workspace name"
              disabled={!canWrite}
              startEditing={startRename && renameKey === 0}
              onSave={(name) => void update(workspace, { name })}
              className="truncate text-xl font-semibold tracking-[-0.01em] text-fg sm:text-2xl"
              inputClassName="text-xl font-semibold text-fg sm:text-2xl"
            />
          </h1>
        </div>
        <InlineEdit
          label="Workspace description"
          value={workspace.description ?? ''}
          placeholder={canWrite ? 'Add workspace description' : 'No description'}
          disabled={!canWrite}
          multiline
          onSave={(description) => void update(workspace, { description: description || null })}
          className="line-clamp-2 text-base leading-6 text-fg-secondary"
          inputClassName="text-base leading-6 text-fg"
        />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge tone={workspace.kind === 'closed' ? 'warning' : 'neutral'} icon={workspace.kind === 'closed' ? <Lock /> : <Users />}>
            {workspace.kind === 'closed' ? 'Closed workspace' : 'Open to everyone in the org'}
          </Badge>
        </div>
      </div>
      <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
        {members.isPending ? (
          <Skeleton width={88} height={32} rounded="full" />
        ) : people.length > 0 ? (
          <AvatarGroup people={people} max={4} size="md" />
        ) : null}
        <AddMenu workspaceId={workspace.id} />
        <WorkspaceMenu workspace={workspace} size="md" onRename={() => setRenameKey((key) => key + 1)} />
      </div>
    </header>
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-6" data-skeleton>
      <div className="flex items-center gap-5">
        <Skeleton width={64} height={64} rounded="lg" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton width="40%" height={28} />
          <Skeleton width="60%" height={14} />
        </div>
      </div>
      <Skeleton height={36} width={260} />
      {[0, 1, 2, 3, 4].map((row) => (
        <Skeleton key={row} height={44} rounded="md" />
      ))}
    </div>
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 404 || error.status === 403);
}

export function WorkspacePage({ workspaceId }: { readonly workspaceId: string }) {
  const { org } = useOrg();
  const tree = useWorkspaceTree(org.id, workspaceId);
  const [view, setView] = useWorkspaceUrlState();
  const tab = view.tab;
  const setTab = (next: string) => setView({ tab: next as WorkspaceTab });
  const crumbs = useMemo(
    () => [
      { label: 'Home', href: routes.home(org.slug) },
      { label: 'Workspaces', href: routes.home(org.slug) },
      { label: tree.data?.workspace.name ?? 'Workspace' },
    ],
    [org.slug, tree.data?.workspace.name],
  );

  return (
    <div className="h-full overflow-y-auto" data-testid="workspace-page">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-5 sm:px-8 sm:py-6">
        <Breadcrumbs items={crumbs} />
        {tree.isPending ? (
          <HeaderSkeleton />
        ) : tree.isError && isNotFound(tree.error) ? (
          <div data-testid="workspace-not-found">
            <EmptyState
              illustration="search"
              title="Workspace not found"
              description="It may have been deleted, or you don't have access to it. Ask a workspace owner to add you."
              actions={
                <Link className="text-sm font-medium text-fg-link hover:underline" href={routes.home(org.slug)}>
                  Go home
                </Link>
              }
            />
          </div>
        ) : tree.isError ? (
          <EmptyState
            illustration="error"
            title="This workspace couldn't be loaded"
            description="It may have been deleted, or you may not have access to it."
            actions={
              <>
                <Button variant="secondary" onClick={() => void tree.refetch()}>
                  Try again
                </Button>
                <Link className="text-sm font-medium text-fg-link hover:underline" href={routes.home(org.slug)}>
                  Go home
                </Link>
              </>
            }
          />
        ) : (
          <>
            <Header workspace={tree.data.workspace} />
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList variant="underline" aria-label="Workspace sections">
                <TabsTrigger value="content">Content</TabsTrigger>
                <TabsTrigger value="members">Members &amp; permissions</TabsTrigger>
              </TabsList>
              <TabsContent value="content" className="pt-5">
                <WorkspaceContentTab tree={tree.data} view={view} onViewChange={setView} />
              </TabsContent>
              <TabsContent value="members" className="pt-5">
                <WorkspaceMembersTab workspace={tree.data.workspace} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}

