import {
  ArrowDownUp,
  BookOpenText,
  Building2,
  CalendarCheck2,
  FileText,
  HandCoins,
  House,
  Landmark,
  Receipt,
  ReceiptText,
  Settings2,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { NavId } from '@/lib/nav';

/** One icon per navigation entry, shared by the More menu, the mobile menu and the command palette. */
export const NAV_ICONS: Readonly<Record<NavId, LucideIcon>> = {
  home: House,
  invoices: FileText,
  collections: HandCoins,
  bills: ReceiptText,
  expenses: Receipt,
  bank: Landmark,
  close: CalendarCheck2,
  customers: Users,
  vendors: Truck,
  payments: Wallet,
  journal: BookOpenText,
  reports: Building2,
  import: ArrowDownUp,
  settings: Settings2,
};
