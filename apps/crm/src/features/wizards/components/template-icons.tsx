import { createElement } from 'react';
import {
  Activity,
  BadgeCheck,
  Building2,
  CalendarDays,
  ChartColumnBig,
  ClipboardList,
  Columns3,
  Contact,
  FileSignature,
  FolderKanban,
  GanttChart,
  Handshake,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  LifeBuoy,
  Megaphone,
  Paperclip,
  RefreshCcw,
  Rocket,
  Table2,
  Target,
  Truck,
  UserPlus,
  UserSearch,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { ViewType } from '@/server/services/contracts/dto';
import type { TemplateGalleryEntry } from '@/server/services/wizards-gallery';

const TEMPLATE_ICONS: Readonly<Record<string, LucideIcon>> = {
  'crm-leads': UserPlus,
  'crm-contacts': Contact,
  'crm-accounts': Building2,
  'crm-deals': Handshake,
  'crm-activities': Activity,
  'cs-onboarding': Rocket,
  'cs-renewals': RefreshCcw,
  'cs-tickets': LifeBuoy,
  'sales-quotes': FileSignature,
  'sales-partners': Target,
  'mkt-campaigns': Megaphone,
  'mkt-events': CalendarDays,
  'proj-tracker': FolderKanban,
  'ops-vendors': Truck,
  'ops-requests': Inbox,
  'hr-recruiting': UserSearch,
  'hr-onboarding': BadgeCheck,
  blank: LayoutGrid,
};

export function templateIcon(entry: Pick<TemplateGalleryEntry, 'id' | 'type'>): LucideIcon {
  if (entry.type === 'solution') return Workflow;
  return TEMPLATE_ICONS[entry.id] ?? Table2;
}

export function boardTemplateIcon(templateId: string): LucideIcon {
  return TEMPLATE_ICONS[templateId] ?? Table2;
}

export const VIEW_ICONS: Readonly<Record<ViewType, LucideIcon>> = {
  table: Table2,
  kanban: Columns3,
  calendar: CalendarDays,
  timeline: GanttChart,
  chart: ChartColumnBig,
  form: ClipboardList,
  dashboard: LayoutDashboard,
  files: Paperclip,
};

/** Icon for a gallery entry (createElement keeps the icon lookup out of render-time component creation). */
export function TemplateGlyph({
  entry,
  className,
}: {
  readonly entry: Pick<TemplateGalleryEntry, 'id' | 'type'>;
  readonly className?: string;
}) {
  return createElement(templateIcon(entry), { 'aria-hidden': true, className });
}

export function BoardGlyph({ templateId, className }: { readonly templateId: string; readonly className?: string }) {
  return createElement(boardTemplateIcon(templateId), { 'aria-hidden': true, className });
}

export function ViewGlyph({ type, className }: { readonly type: ViewType; readonly className?: string }) {
  return createElement(VIEW_ICONS[type] ?? Table2, { 'aria-hidden': true, className });
}
