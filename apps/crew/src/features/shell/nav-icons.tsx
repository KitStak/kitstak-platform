import { ArrowDownUp, BadgeCheck, CalendarDays, CalendarOff, Clock3, House, ListChecks, Settings2, TrendingUp, UserCheck, Users, type LucideIcon } from 'lucide-react';
import type { NavId } from '@/lib/nav';

/** One icon per navigation entry, shared by the More menu, the mobile menu, the command palette and the search page. */
export const NAV_ICONS: Readonly<Record<NavId, LucideIcon>> = {
  home: House,
  today: UserCheck,
  schedule: CalendarDays,
  time: Clock3,
  people: Users,
  attendance: ListChecks,
  plan: TrendingUp,
  'time-off': CalendarOff,
  skills: BadgeCheck,
  import: ArrowDownUp,
  settings: Settings2,
};
