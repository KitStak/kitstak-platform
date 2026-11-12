'use client';
import {
  AlignLeft,
  Archive,
  Bell,
  Calendar,
  CalendarClock,
  CalendarRange,
  CircleDot,
  CirclePlus,
  DollarSign,
  Eraser,
  Filter,
  FolderInput,
  Hash,
  Link2,
  ListChecks,
  Mail,
  MapPin,
  MessageSquareText,
  Paperclip,
  Phone,
  Pencil,
  Repeat,
  SquareCheck,
  Star,
  Tag,
  Type,
  UserPlus,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ColumnType } from '@/server/db/schema/cell-values';

const COLUMN_ICONS: Partial<Record<ColumnType, LucideIcon>> = {
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
  link: Link2,
  dropdown: ListChecks,
  tags: Tag,
  checkbox: SquareCheck,
  rating: Star,
  files: Paperclip,
  location: MapPin,
};

export function ColumnTypeIcon({
  type,
  className,
}: {
  readonly type: ColumnType;
  readonly className?: string;
}) {
  const Icon = COLUMN_ICONS[type] ?? Type;
  return <Icon aria-hidden className={className} />;
}

const CLAUSE_ICONS: Readonly<Record<string, LucideIcon>> = {
  status_changed: CircleDot,
  column_changed: Pencil,
  person_assigned: UserPlus,
  item_created: CirclePlus,
  item_moved_to_group: FolderInput,
  date_arrived: CalendarClock,
  status_is: Filter,
  column_is_empty: Filter,
  column_not_empty: Filter,
  number_compare: Hash,
  person_is: Users,
  in_group: FolderInput,
  notify: Bell,
  create_update: MessageSquareText,
  set_status: CircleDot,
  assign_person: UserPlus,
  set_date: Calendar,
  clear_column: Eraser,
  move_to_group: FolderInput,
  archive_item: Archive,
  create_item: CirclePlus,
};

export function ClauseIcon({ type, className }: { readonly type: string; readonly className?: string }) {
  const Icon = CLAUSE_ICONS[type] ?? Zap;
  return <Icon aria-hidden className={className} />;
}

export { Repeat as RecurringIcon };
