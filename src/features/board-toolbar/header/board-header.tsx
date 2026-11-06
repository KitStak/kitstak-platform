'use client';

/**
 * Board header (BT-001…006): breadcrumb, icon, inline-editable name, info popover, favorite
 * star, description line, and the right cluster (members, Invite, Activity, Integrate,
 * Automate with count, "…").
 */
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Bot, History, Plug, Star, UserPlus } from 'lucide-react';
import { AvatarGroup, Button, IconButton, Tooltip, buttonVariants, cn } from '@/components/ui';
import { EntityIcon } from '@/features/shell/entity-icon';
import { useApi, useOrgId } from '@/lib/hooks';
import { queryKeys } from '@/lib/query-keys';
import type { BoardDto, UserSummaryDto } from '@/server/services/contracts/dto';
import type { BoardCommands } from '../hooks/use-board-commands';
import { BoardBreadcrumb, BoardInfoButton, type BoardLocation } from './board-info';
import { InlineText } from './inline-text';

export interface BoardHeaderProps {
  readonly orgSlug: string;
  readonly board: BoardDto;
  readonly users: readonly UserSummaryDto[];
  readonly totalItems: number;
  readonly location: BoardLocation;
  readonly commands: BoardCommands;
  readonly collapsed: boolean;
  readonly editingName: boolean;
  readonly onEditingNameChange: (editing: boolean) => void;
  readonly automationsHref: string;
  readonly integrationsHref: string;
  readonly onShare: () => void;
  readonly onActivity: () => void;
  readonly onSettings: () => void;
  /** The "…" menu, rendered at the end of the right cluster. */
  readonly menu: React.ReactNode;
}

function useAutomationCount(boardId: string): number | null {
  const api = useApi();
  const orgId = useOrgId();
  const query = useQuery({
    queryKey: queryKeys.boardAutomations(orgId, boardId),
    queryFn: () => api.automations.list(boardId),
    staleTime: 60_000,
  });
  if (!Array.isArray(query.data)) return null;
  return (query.data as { enabled?: boolean }[]).filter((entry) => entry.enabled !== false).length;
}

export function BoardHeader(props: BoardHeaderProps) {
  const { board, users, commands, collapsed } = props;
  const [editingDescription, setEditingDescription] = useState(false);
  const [pop, setPop] = useState(false);
  const automationCount = useAutomationCount(board.id);
  const members = board.members
    .map((member) => users.find((user) => user.id === member.userId))
    .filter((user): user is UserSummaryDto => Boolean(user))
    .map((user) => ({ id: user.id, name: user.name, src: user.image }));
  const canEdit = board.canEdit;

  const star = () => {
    if (!commands.isFavorite) {
      setPop(true);
      window.setTimeout(() => setPop(false), 260);
    }
    commands.toggleFavorite();
  };

  return (
    <header
      data-testid="board-header"
      data-collapsed={collapsed || undefined}
      className={cn('flex flex-col px-8 max-md:px-4', collapsed ? 'pt-2 pb-1' : 'pt-3 pb-1')}
    >
      {collapsed ? null : <BoardBreadcrumb orgSlug={props.orgSlug} location={props.location} board={board} />}
      <div className="group/title flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <span className="mr-1 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted max-sm:hidden" aria-hidden>
            <EntityIcon type="board" boardKind={board.kind} className="size-[18px]" />
          </span>
          <h1 className="flex min-w-0 items-center font-heading text-xl font-medium text-fg" data-testid="board-title">
            <InlineText
              value={board.name}
              onCommit={commands.rename}
              label="Board name"
              required
              disabled={!canEdit}
              editing={props.editingName}
              onEditingChange={props.onEditingNameChange}
              testId="board-name"
              className={cn('h-9 leading-9', collapsed && 'h-8 text-lg leading-8')}
            />
          </h1>
          <BoardInfoButton
            board={board}
            users={users}
            location={props.location}
            totalItems={props.totalItems}
            onEditDescription={() => setEditingDescription(true)}
            onOpenSettings={props.onSettings}
          />
          <Tooltip content={commands.isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
            <button
              type="button"
              aria-label={commands.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={commands.isFavorite}
              data-testid="board-favorite"
              onClick={star}
              className={cn(
                'inline-flex size-7 shrink-0 items-center justify-center rounded-sm transition-[opacity,background-color,color] duration-[var(--duration-fast)] ease-out',
                'hover:bg-hover active:bg-pressed focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                commands.isFavorite
                  ? 'text-[var(--label-yellow)] opacity-100'
                  : 'text-icon opacity-0 group-hover/title:opacity-100 max-md:opacity-100',
              )}
            >
              <Star
                aria-hidden
                className={cn('size-[18px] transition-transform duration-[250ms] ease-[var(--ease-emphasized)] motion-reduce:transition-none', pop && 'scale-125')}
                fill={commands.isFavorite ? 'currentColor' : 'none'}
              />
            </button>
          </Tooltip>
        </div>
        <div className="flex shrink-0 items-center gap-2" data-testid="board-header-actions">
          {members.length ? (
            <button
              type="button"
              onClick={props.onShare}
              aria-label={`${members.length} board members. Manage members`}
              className="rounded-full p-0.5 transition-colors duration-[var(--duration-instant)] hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus max-sm:hidden"
            >
              <AvatarGroup people={members} max={3} size="sm" />
            </button>
          ) : null}
          <Link href={props.integrationsHref} className={cn(buttonVariants({ variant: 'ghost', size: 'md' }), 'max-lg:hidden')}>
            <Plug aria-hidden />
            Integrate
          </Link>
          <Link
            href={props.automationsHref}
            data-testid="board-automate"
            className={cn(buttonVariants({ variant: 'ghost', size: 'md' }), 'max-md:hidden')}
          >
            <Bot aria-hidden />
            Automate
            {automationCount ? (
              <span className="rounded-full bg-muted px-1.5 text-xs font-semibold text-fg-secondary tabular-nums">
                {automationCount}
              </span>
            ) : null}
          </Link>
          <IconButton label="Activity log" icon={<History aria-hidden />} onClick={props.onActivity} data-testid="board-activity-trigger" />
          <Button variant="secondary" size="md" leadingIcon={<UserPlus aria-hidden />} onClick={props.onShare} data-testid="board-invite">
            <span className="max-sm:sr-only">Invite</span>
            {members.length ? <span className="text-fg-muted tabular-nums max-sm:hidden">/ {members.length}</span> : null}
          </Button>
          {props.menu}
        </div>
      </div>
      {collapsed ? null : (
        <div className="-mt-1 flex min-h-6 items-center">
          {board.description || editingDescription ? (
            <InlineText
              value={board.description ?? ''}
              onCommit={commands.setDescription}
              label="Board description"
              placeholder="Add board description"
              maxLength={2000}
              disabled={!canEdit}
              editing={editingDescription}
              onEditingChange={setEditingDescription}
              testId="board-description"
              className="h-6 max-w-3xl text-base leading-6 text-fg-muted"
            />
          ) : canEdit ? (
            <button
              type="button"
              onClick={() => setEditingDescription(true)}
              className="-mx-1.5 h-6 rounded-sm px-1.5 text-base text-fg-muted opacity-0 transition-[opacity,background-color] duration-[var(--duration-fast)] group-hover/title:opacity-100 hover:bg-hover hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus"
            >
              Add board description
            </button>
          ) : null}
        </div>
      )}
    </header>
  );
}
