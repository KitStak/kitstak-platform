/**
 * Icons for projects, spaces, goals and templates, stored by name (pm.projects.icon etc.).
 * `ENTITY_ICON_NAMES` is the picker's choice list; unknown names fall back to a folder.
 */
import {
  BarChart3,
  Box,
  Briefcase,
  Bug,
  Building2,
  CalendarDays,
  ClipboardList,
  Code2,
  Compass,
  Flag,
  Folder,
  FolderKanban,
  Gem,
  Globe,
  GraduationCap,
  Handshake,
  Heart,
  Lightbulb,
  LayoutTemplate,
  Megaphone,
  Package,
  Palette,
  PenTool,
  Rocket,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Star,
  Target,
  Truck,
  Users,
  Warehouse,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { createElement, type CSSProperties } from 'react';
import { cn } from '@/components/ui/cn';
import { isLabelColor } from '@/components/ui/label-color';

export const ENTITY_ICONS: Readonly<Record<string, LucideIcon>> = {
  'folder-kanban': FolderKanban,
  folder: Folder,
  rocket: Rocket,
  target: Target,
  flag: Flag,
  briefcase: Briefcase,
  handshake: Handshake,
  warehouse: Warehouse,
  truck: Truck,
  package: Package,
  box: Box,
  'shopping-cart': ShoppingCart,
  megaphone: Megaphone,
  'calendar-days': CalendarDays,
  'clipboard-list': ClipboardList,
  'bar-chart-3': BarChart3,
  users: Users,
  'building-2': Building2,
  'code-2': Code2,
  bug: Bug,
  zap: Zap,
  wrench: Wrench,
  'settings-2': Settings2,
  'shield-check': ShieldCheck,
  palette: Palette,
  'pen-tool': PenTool,
  lightbulb: Lightbulb,
  sparkles: Sparkles,
  star: Star,
  heart: Heart,
  gem: Gem,
  globe: Globe,
  compass: Compass,
  'graduation-cap': GraduationCap,
  'layout-template': LayoutTemplate,
};

export const ENTITY_ICON_NAMES: readonly string[] = Object.keys(ENTITY_ICONS);

export function entityIcon(name: string | null | undefined): LucideIcon {
  return (name && ENTITY_ICONS[name]) || FolderKanban;
}

export interface EntityIconProps {
  readonly icon: string | null | undefined;
  readonly color?: string | null;
  /** Tile size in px (icon is ~60%). */
  readonly size?: number;
  /** `tile` = colored rounded square (projects), `plain` = colored glyph only. */
  readonly variant?: 'tile' | 'plain';
  readonly className?: string;
}

/** Project / space glyph in its label color. */
export function EntityIcon({ icon, color, size = 20, variant = 'tile', className }: EntityIconProps) {
  const glyph = entityIcon(icon);
  const tone = isLabelColor(color) ? color : 'blue';
  if (variant === 'plain') {
    return createElement(glyph, {
      'aria-hidden': true,
      className: cn('shrink-0', className),
      style: { width: size, height: size, color: `var(--label-${tone}-text)` },
    });
  }
  const style: CSSProperties = {
    width: size,
    height: size,
    background: `var(--label-${tone}-subtle)`,
    color: `var(--label-${tone}-text)`,
  };
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center rounded-md', className)} style={style}>
      {createElement(glyph, { style: { width: Math.round(size * 0.62), height: Math.round(size * 0.62) } })}
    </span>
  );
}
