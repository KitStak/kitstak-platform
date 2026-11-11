'use client';

/** Dashboard header: inline-editable name and description, favorite, viewers, Share and "…" menu. */
import { useState, type KeyboardEvent } from 'react';
import {
  Copy,
  Globe2,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  Lock,
  LockOpen,
  MoreHorizontal,
  Printer,
  RefreshCw,
  Share2,
  Star,
  Trash2,
  Tv,
} from 'lucide-react';
import {
  AvatarGroup,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
  cn,
} from '@/components/ui';
import type { DashboardDto, UserSummaryDto } from '@/server/services/contracts/dto';
import type { DashboardSettings } from '@/server/services/contracts/dashboard-insights';

export interface DashboardHeaderProps {
  readonly dashboard: DashboardDto;
  readonly canEdit: boolean;
  readonly favorite: boolean;
  readonly viewers: readonly UserSummaryDto[];
  readonly settings: Required<Pick<DashboardSettings, 'privacy' | 'autoRefreshSec' | 'lockLayout'>>;
  readonly onRename: (name: string) => void;
  readonly onDescribe: (description: string | null) => void;
  readonly onToggleFavorite: () => void;
  readonly onShare: () => void;
  readonly onDuplicate: () => void;
  readonly onPresent: () => void;
  readonly onDelete: () => void;
  readonly onCopyLink: () => void;
  readonly onSettings: (settings: DashboardSettings) => void;
  /** Re-pack widgets to close gaps (omitted when the layout cannot change). */
  readonly onTidy?: () => void;
}

function InlineText({
  value,
  placeholder,
  editable,
  multiline,
  label,
  className,
  onCommit,
}: {
  readonly value: string;
  readonly placeholder: string;
  readonly editable: boolean;
  readonly multiline?: boolean;
  readonly label: string;
  readonly className: string;
  readonly onCommit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing) {
    const commit = () => {
      setEditing(false);
      if (draft.trim() !== value) onCommit(draft.trim());
    };
    const common = {
      autoFocus: true,
      'aria-label': label,
      value: draft,
      onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
      onBlur: commit,
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'Enter' && !(multiline && event.shiftKey)) {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      },
      className: cn(className, 'w-full rounded-sm border border-primary bg-panel px-1.5 outline-none shadow-[0_0_0_3px_var(--focus-ring-soft)]'),
    };
    return multiline ? <textarea rows={2} maxLength={2000} {...common} /> : <input maxLength={255} {...common} />;
  }
  if (!editable) {
    return value ? <span className={className}>{value}</span> : null;
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className={cn(
        className,
        'block max-w-full truncate rounded-sm border border-transparent px-1.5 text-left outline-none transition-colors duration-[var(--duration-instant)]',
        'hover:border-border-input focus-visible:outline-2 focus-visible:outline-focus',
        !value && 'text-fg-muted',
      )}
      aria-label={`${label}: ${value || 'empty'}. Click to edit`}
    >
      {value || placeholder}
    </button>
  );
}

export function DashboardHeader(props: DashboardHeaderProps) {
  const { dashboard, canEdit, favorite, viewers, settings } = props;
  return (
    <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
      <span aria-hidden className="mt-1 hidden size-10 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary-text sm:flex [&_svg]:size-5">
        <LayoutDashboard />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1">
          <h1 className="min-w-0 -ml-1.5">
            <InlineText
              value={dashboard.name}
              placeholder="Untitled dashboard"
              editable={canEdit}
              label="Dashboard name"
              className="text-xl font-semibold tracking-[-0.01em] text-fg sm:text-2xl"
              onCommit={(name) => name && props.onRename(name)}
            />
          </h1>
          <Tooltip content={favorite ? 'Remove from favorites' : 'Add to favorites'}>
            <button
              type="button"
              aria-pressed={favorite}
              aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
              onClick={props.onToggleFavorite}
              data-testid="dashboard-favorite"
              className="flex size-8 shrink-0 items-center justify-center rounded-sm outline-none transition-[background-color,transform] duration-[var(--duration-fast)] hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus active:scale-90"
            >
              <Star aria-hidden className={cn('size-[18px]', favorite ? 'fill-[var(--warning-accent)] text-[var(--warning-accent)]' : 'text-icon')} />
            </button>
          </Tooltip>
          {settings.privacy === 'private' ? (
            <Tooltip content="Private: only you and admins can see it">
              <Lock aria-label="Private dashboard" className="size-4 shrink-0 text-icon" />
            </Tooltip>
          ) : null}
        </div>
        <div className="-ml-1.5 min-w-0 max-w-3xl">
          <InlineText
            value={dashboard.description ?? ''}
            placeholder="Add a description"
            editable={canEdit}
            multiline
            label="Dashboard description"
            className="text-base text-fg-secondary"
            onCommit={(description) => props.onDescribe(description || null)}
          />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {viewers.length > 0 ? (
          <Tooltip content={settings.privacy === 'private' ? 'Only you can see this dashboard' : `${viewers.length} people can see this dashboard`}>
            <span className="hidden md:inline-flex" tabIndex={0}>
              <AvatarGroup
                people={viewers.map((user) => ({ id: user.id, name: user.name, src: user.image }))}
                max={4}
                size="md"
                className="-space-x-1 [&>span]:ring-[var(--surface-sunken)]"
                renderOverflow={(hidden) => (
                  <span className="flex size-full items-center justify-center rounded-full border border-border-default bg-panel text-xs font-semibold text-fg-secondary">
                    +{hidden.length}
                  </span>
                )}
              />
            </span>
          </Tooltip>
        ) : null}
        <Button variant="secondary" leadingIcon={<Share2 />} onClick={props.onShare} data-testid="dashboard-share">
          <span className="hidden sm:inline">Share</span>
        </Button>
        <DashboardMenu {...props} />
      </div>
    </header>
  );
}

function DashboardMenu({ canEdit, settings, onDuplicate, onPresent, onDelete, onCopyLink, onSettings, onTidy }: DashboardHeaderProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Dashboard options" icon={<MoreHorizontal />} variant="outline" data-testid="dashboard-menu" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[232px]">
        <DropdownMenuItem icon={<Tv />} onSelect={onPresent}>
          Present (TV mode)
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Link2 />} onSelect={onCopyLink}>
          Copy link with filters
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Printer />} onSelect={() => window.print()}>
          Export as PDF
        </DropdownMenuItem>
        {canEdit ? (
          <>
            <DropdownMenuItem icon={<Copy />} onSelect={onDuplicate}>
              Duplicate dashboard
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {onTidy ? (
              <DropdownMenuItem icon={<LayoutGrid />} onSelect={onTidy} disabled={settings.lockLayout}>
                Tidy up layout
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuCheckboxItem checked={settings.lockLayout} onCheckedChange={(value) => onSettings({ lockLayout: value === true })}>
              <span className="flex items-center gap-2">
                {settings.lockLayout ? <Lock aria-hidden className="size-4 text-icon" /> : <LockOpen aria-hidden className="size-4 text-icon" />}
                Lock layout
              </span>
            </DropdownMenuCheckboxItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger icon={<RefreshCw />}>Auto refresh</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={String(settings.autoRefreshSec)} onValueChange={(value) => onSettings({ autoRefreshSec: Number(value) as 0 | 60 | 300 | 900 })}>
                  <DropdownMenuRadioItem value="0">Off</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="60">Every minute</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="300">Every 5 minutes</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="900">Every 15 minutes</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger icon={settings.privacy === 'private' ? <Lock /> : <Globe2 />}>Privacy</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={settings.privacy} onValueChange={(value) => onSettings({ privacy: value === 'private' ? 'private' : 'main' })}>
                  <DropdownMenuRadioItem value="main">Workspace: everyone in the workspace</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="private">Private: only me and admins</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Trash2 />} variant="danger" onSelect={onDelete}>
              Delete dashboard
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
