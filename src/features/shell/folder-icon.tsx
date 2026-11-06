'use client';
/** Folder glyph: the folder's custom icon (if any) in its label color, else an open/closed folder. */
import {
  Briefcase,
  Building2,
  CalendarDays,
  ChartColumnBig,
  Flag,
  Folder,
  FolderOpen,
  Globe,
  Heart,
  Lightbulb,
  Megaphone,
  Package,
  Rocket,
  Star,
  Target,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/components/ui/cn';
import type { FolderIcon as FolderIconName } from '@/server/services/shell-folders-model';
import { useFolderIcons } from './api';
import { useOrg } from './org-context';

export const FOLDER_ICON_META: Readonly<Record<FolderIconName, { readonly icon: LucideIcon; readonly label: string }>> = {
  folder: { icon: Folder, label: 'Folder' },
  briefcase: { icon: Briefcase, label: 'Briefcase' },
  target: { icon: Target, label: 'Target' },
  rocket: { icon: Rocket, label: 'Rocket' },
  star: { icon: Star, label: 'Star' },
  heart: { icon: Heart, label: 'Heart' },
  flag: { icon: Flag, label: 'Flag' },
  trophy: { icon: Trophy, label: 'Trophy' },
  users: { icon: Users, label: 'Team' },
  building: { icon: Building2, label: 'Building' },
  globe: { icon: Globe, label: 'Globe' },
  megaphone: { icon: Megaphone, label: 'Megaphone' },
  chart: { icon: ChartColumnBig, label: 'Chart' },
  calendar: { icon: CalendarDays, label: 'Calendar' },
  lightbulb: { icon: Lightbulb, label: 'Idea' },
  package: { icon: Package, label: 'Package' },
};

export interface FolderGlyphProps {
  readonly folderId: string;
  readonly color: string | null;
  readonly open?: boolean;
  readonly className?: string;
}

export function FolderGlyph({ folderId, color, open = false, className }: FolderGlyphProps) {
  const { org } = useOrg();
  const icons = useFolderIcons(org.id);
  const custom = icons.data?.[folderId];
  const Icon = custom && custom !== 'folder' ? FOLDER_ICON_META[custom].icon : open ? FolderOpen : Folder;
  return (
    <Icon
      aria-hidden
      data-folder-icon={custom ?? 'folder'}
      className={cn('size-4 shrink-0', className)}
      style={color ? { color: `var(--label-${color}-text, var(--label-${color}))` } : undefined}
    />
  );
}
