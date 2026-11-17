import {
  ArrowDownUp,
  Bell,
  Calculator,
  CircleDollarSign,
  ClipboardPen,
  FileText,
  Gauge,
  House,
  Package,
  Settings2,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { NavId } from '@/lib/nav';

/** One icon per navigation entry, shared by the sidebar, the command palette and the search page. */
export const NAV_ICONS: Readonly<Record<NavId, LucideIcon>> = {
  home: House,
  jobs: Package,
  log: ClipboardPen,
  profit: CircleDollarSign,
  labor: Users,
  alerts: Bell,
  reports: FileText,
  'target-pace': Gauge,
  calculator: Calculator,
  goals: Target,
  import: ArrowDownUp,
  settings: Settings2,
};
