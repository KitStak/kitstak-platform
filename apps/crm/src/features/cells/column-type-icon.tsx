import {
  AlignLeft,
  Cable,
  Calendar,
  CalendarPlus,
  CalendarRange,
  CircleDot,
  Copy,
  DollarSign,
  Fingerprint,
  Flag,
  Gauge,
  Hash,
  Heading,
  History,
  Link,
  ListChecks,
  Mail,
  MapPin,
  MousePointerClick,
  Paperclip,
  Phone,
  Sigma,
  SquareCheck,
  Star,
  Tag,
  Type,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cn, labelColorStyle, type LabelColor } from '@/components/ui';
import type { ColumnType } from '@/server/db/schema/cell-values';
import { COLUMN_TYPE_REGISTRY, type ColumnCategory } from '@/server/db/schema/column-types';

const ICONS: Readonly<Record<ColumnType, LucideIcon>> = {
  name: Heading,
  text: Type,
  long_text: AlignLeft,
  status: CircleDot,
  people: Users,
  date: Calendar,
  timeline: CalendarRange,
  number: Hash,
  currency: DollarSign,
  email: Mail,
  phone: Phone,
  link: Link,
  dropdown: ListChecks,
  tags: Tag,
  checkbox: SquareCheck,
  rating: Star,
  progress: Gauge,
  files: Paperclip,
  connect_boards: Cable,
  mirror: Copy,
  formula: Sigma,
  location: MapPin,
  country: Flag,
  last_updated: History,
  creation_log: CalendarPlus,
  item_id: Fingerprint,
  button: MousePointerClick,
};

/** Tile colors by column category (column picker / Column Center). */
const CATEGORY_COLOR: Readonly<Record<ColumnCategory, LabelColor>> = {
  essentials: 'green',
  people: 'blue',
  time: 'purple',
  numbers: 'orange',
  contact: 'teal',
  relations: 'pink',
  meta: 'gray',
};

export interface ColumnTypeIconProps {
  readonly type: ColumnType;
  /** `tile` = white glyph on the category color (pickers); `plain` = muted glyph (headers). */
  readonly variant?: 'plain' | 'tile';
  readonly size?: 'sm' | 'md' | 'lg';
  readonly className?: string;
  /** Accessible label; decorative when omitted. */
  readonly label?: string;
}

const GLYPH = { sm: 'size-3.5', md: 'size-4', lg: 'size-5' } as const;
const TILE = { sm: 'size-5', md: 'size-6', lg: 'size-8' } as const;

export function columnTypeLabel(type: ColumnType): string {
  return COLUMN_TYPE_REGISTRY[type].label;
}

/** The glyph for a column type, plain or as a colored tile. */
export function ColumnTypeIcon({ type, variant = 'plain', size = 'md', className, label }: ColumnTypeIconProps) {
  const Icon = ICONS[type];
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
  if (variant === 'plain') return <Icon {...a11y} className={cn(GLYPH[size], 'shrink-0 text-icon', className)} />;
  // The item name column gets its own tile color so it never reads as a plain Text column.
  const color = type === 'name' ? 'dark-blue' : CATEGORY_COLOR[COLUMN_TYPE_REGISTRY[type].category];
  return (
    <span
      {...a11y}
      style={labelColorStyle(color)}
      className={cn(TILE[size], 'inline-flex shrink-0 items-center justify-center rounded-sm bg-[var(--lc-bg)] text-[var(--lc-fg)]', className)}
    >
      <Icon aria-hidden className={GLYPH[size === 'lg' ? 'md' : 'sm']} />
    </span>
  );
}
