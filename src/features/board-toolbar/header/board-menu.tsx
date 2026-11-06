'use client';

/** The board "…" menu (TB-010): view, board, data, activity & integrations, danger. */
import { useRouter } from 'next/navigation';
import {
  Archive,
  ArrowRightLeft,
  Bot,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  FileSpreadsheet,
  History,
  LayoutTemplate,
  Link2,
  Lock,
  MoreHorizontal,
  PanelTopClose,
  PanelTopOpen,
  Pencil,
  Plug,
  Printer,
  Settings2,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
  toast,
} from '@/components/ui';
import type { BoardDto } from '@/server/services/contracts/dto';
import type { BoardCommands } from '../hooks/use-board-commands';

export interface BoardMenuProps {
  readonly board: BoardDto;
  readonly commands: BoardCommands;
  readonly automationsHref: string;
  readonly integrationsHref: string;
  readonly headerCollapsed: boolean;
  readonly onToggleHeader: () => void;
  readonly onRename: () => void;
  readonly onDuplicate: () => void;
  readonly onMove: () => void;
  readonly onShare: () => void;
  readonly onSettings: () => void;
  readonly onActivity: () => void;
  readonly onImport: () => void;
  readonly onDelete: () => void;
  readonly onExport: (format: 'csv' | 'xlsx') => void;
}

export function BoardMenu(props: BoardMenuProps) {
  const { board, commands } = props;
  const router = useRouter();
  const canEdit = board.canEdit;
  const copyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}`;
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.success('Board link copied'))
      .catch(() => toast.error("Couldn't copy the link", url));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="More board actions" icon={<MoreHorizontal aria-hidden />} data-testid="board-menu-trigger" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" data-testid="board-menu">
        <DropdownMenuLabel>View</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem
            icon={props.headerCollapsed ? <PanelTopOpen aria-hidden /> : <PanelTopClose aria-hidden />}
            onSelect={props.onToggleHeader}
          >
            {props.headerCollapsed ? 'Expand header' : 'Collapse header'}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<ExternalLink aria-hidden />}
            onSelect={() => window.open(window.location.href, '_blank', 'noopener')}
          >
            Open in new tab
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Link2 aria-hidden />} onSelect={copyLink}>
            Copy board link
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Board</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem icon={<Star aria-hidden />} onSelect={commands.toggleFavorite}>
            {commands.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Pencil aria-hidden />} disabled={!canEdit} onSelect={props.onRename}>
            Rename board
          </DropdownMenuItem>
          <DropdownMenuItem icon={<CopyPlus aria-hidden />} onSelect={props.onDuplicate}>
            Duplicate board…
          </DropdownMenuItem>
          <DropdownMenuItem icon={<ArrowRightLeft aria-hidden />} disabled={!canEdit} onSelect={props.onMove}>
            Move to…
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<LayoutTemplate aria-hidden />}
            disabled={!canEdit}
            onSelect={() => void commands.saveAsTemplate()}
          >
            Save as template
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Lock aria-hidden />} onSelect={props.onShare}>
            Permissions & privacy
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Data</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger icon={<Download aria-hidden />}>Export this view</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              <DropdownMenuItem icon={<FileSpreadsheet aria-hidden />} onSelect={() => props.onExport('xlsx')}>
                Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem icon={<Copy aria-hidden />} onSelect={() => props.onExport('csv')}>
                CSV (.csv)
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem icon={<Upload aria-hidden />} disabled={!canEdit} onSelect={props.onImport}>
            Import data…
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Printer aria-hidden />} onSelect={() => window.print()}>
            Print
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Settings2 aria-hidden />} onSelect={props.onSettings}>
            Board settings
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Activity & integrations</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem icon={<History aria-hidden />} onSelect={props.onActivity}>
            Activity log
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Bot aria-hidden />} onSelect={() => router.push(props.automationsHref)}>
            Automations
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Plug aria-hidden />} onSelect={() => router.push(props.integrationsHref)}>
            Integrations
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem icon={<Archive aria-hidden />} disabled={!canEdit} onSelect={commands.archive}>
            Archive board
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Trash2 aria-hidden />}
            variant="danger"
            disabled={!canEdit}
            onSelect={props.onDelete}
            data-testid="board-menu-delete"
          >
            Delete board…
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
