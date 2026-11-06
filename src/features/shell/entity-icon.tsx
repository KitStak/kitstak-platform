import {
  Activity,
  Building2,
  ChartColumnBig,
  Contact,
  Folder,
  FolderOpen,
  FolderKanban,
  Handshake,
  LayoutDashboard,
  Table2,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/components/ui/cn';
import type { BoardKind } from './api';

/** Icon + accent per board kind: fast visual scanning in the tree, favorites and search. */
export const BOARD_KIND_META: Readonly<
  Record<BoardKind, { readonly icon: LucideIcon; readonly label: string; readonly accent: string }>
> = {
  leads: { icon: Target, label: 'Leads', accent: 'var(--label-orange-text)' },
  contacts: { icon: Contact, label: 'Contacts', accent: 'var(--label-sky-text)' },
  accounts: { icon: Building2, label: 'Accounts', accent: 'var(--label-indigo-text)' },
  deals: { icon: Handshake, label: 'Deals', accent: 'var(--label-green-text)' },
  activities: { icon: Activity, label: 'Activities', accent: 'var(--label-pink-text)' },
  projects: { icon: FolderKanban, label: 'Projects', accent: 'var(--label-purple-text)' },
  custom: { icon: Table2, label: 'Board', accent: 'var(--icon-default)' },
};

export interface EntityIconProps {
  readonly type: 'board' | 'dashboard' | 'folder' | 'folder-open' | 'chart';
  readonly boardKind?: BoardKind | null;
  /** Tint the icon with the board-kind accent. */
  readonly colored?: boolean;
  /** Folder color (label palette token name). */
  readonly color?: string | null;
  readonly className?: string;
}

export function EntityIcon({ type, boardKind, colored = true, color, className }: EntityIconProps) {
  const base = cn('size-4 shrink-0', className);
  if (type === 'folder' || type === 'folder-open') {
    const Icon = type === 'folder-open' ? FolderOpen : Folder;
    return (
      <Icon aria-hidden className={base} style={color ? { color: `var(--label-${color}-text, var(--label-${color}))` } : undefined} />
    );
  }
  if (type === 'dashboard') {
    return (
      <LayoutDashboard
        aria-hidden
        className={base}
        style={colored ? { color: 'var(--label-teal-text)' } : undefined}
      />
    );
  }
  if (type === 'chart') return <ChartColumnBig aria-hidden className={base} />;
  const meta = BOARD_KIND_META[boardKind ?? 'custom'];
  const Icon = meta.icon;
  return <Icon aria-hidden className={base} style={colored ? { color: meta.accent } : undefined} />;
}
